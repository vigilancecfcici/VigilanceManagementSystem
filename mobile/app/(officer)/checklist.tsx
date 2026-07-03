import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Image,
  Animated,
  Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { saveDraft, loadDraft, deleteDraft, type DraftForm } from '../../lib/storage';
import { queueInspection } from '../../lib/syncQueue';
import { getDeviceAudit } from '../../lib/deviceInfo';
import { useLocationPing } from '../../lib/useLocationPing';
import { ToastMessage } from '../../components/ToastMessage';
import { ItemAttachments, type ItemAttachment } from '../../components/ItemAttachments';
import { isViolationResponse, isCompliantResponse } from '../../lib/checklistScoring';
import {
  normalizeOptionColorMap,
  optionHighlightButtonColors,
  type OptionColorMap,
} from '../../lib/checklistOptionColors';
import {
  uploadInspectionDocumentFile,
  uploadInspectionImageFile,
} from '../../lib/inspectionStorageUpload';
import { uploadInspectionFiles } from '../../lib/uploadInspectionFiles';
import { getPreviousRiskItems } from '../../lib/queries';
import { claimBranchInspection } from '../../lib/branchLocks';
import VideoCapture from '../../components/VideoCapture';
import { uploadInspectionVideo } from '../../lib/videoUpload';

const today = new Date().toISOString().split('T')[0];
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const toValidTime = (value: string | null | undefined, fallback: string) => {
  const normalized = value?.trim() ?? '';
  return /^\d{1,2}:\d{2}$/.test(normalized) ? normalized : fallback;
};

const YELLOW_REALTIME_THRESHOLD = 3;
const ITEMS_PER_PAGE = 4;
const STAFF_BEHAVIOUR_ITEM_TEXT = 'Staff behaviour towards customers';
const STAFF_BEHAVIOUR_OPTIONS = [
  { label: 'GOOD', value: 'Good' as const },
  { label: 'MODERATE', value: 'Moderate' as const },
  { label: 'BAD', value: 'Bad' as const },
];

const isStaffBehaviourItem = (itemText: string) => itemText?.trim() === STAFF_BEHAVIOUR_ITEM_TEXT;

type ChecklistTemplateRow = {
  id: string;
  section: string;
  item_text: string;
  item_order: number;
  risk_level?: string | null;
  trigger_on_no?: boolean | null;
  options?: string[] | null;
  option_colors?: OptionColorMap | null;
  risk_classifications?:
    | { risk_level?: string | null; trigger_on_no?: boolean | null }
    | { risk_level?: string | null; trigger_on_no?: boolean | null }[]
    | null;
};

type ChecklistItem = {
  id: string;
  section: string;
  item_text: string;
  item_order: number;
  risk_level?: 'RED' | 'YELLOW' | 'GREEN';
  trigger_on_no: boolean;
  options: string[] | null;
  option_colors: OptionColorMap | null;
};

export default function ChecklistScreen() {
  const { branchId, branchName, branchType, officerLat, officerLon, inspectionId: routeInspectionId, isEdit, reopen } =
    useLocalSearchParams<{
      branchId: string;
      branchName: string;
      branchType: string;
      officerLat: string;
      officerLon: string;
      inspectionId?: string;
      isEdit?: string;
      reopen?: string;
    }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userName, userRolesId } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const lastTriggeredRedResponse = useRef<Record<string, string | null>>({});

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [responses, setResponses] = useState<Record<string, { response: string | null; remark: string }>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [date] = useState(today);
  const [timeIn, setTimeIn] = useState(nowTime());
  const [timeOut, setTimeOut] = useState('');
  const [generalRemark, setGeneralRemark] = useState('');
  const [itemFiles, setItemFiles] = useState<Record<string, ItemAttachment[]>>({});
  const [videoCaptureItemId, setVideoCaptureItemId] = useState<string | null>(null);
  const [itemVideos, setItemVideos] = useState<
    Record<
      string,
      Array<{
        uri: string;
        fileUrl?: string;
        fileName?: string;
        durationSeconds: number;
        uploading: boolean;
      }>
    >
  >({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: 'success' | 'error' | 'warning' }>({
    visible: false,
    message: '',
    type: 'success',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageOpacity] = useState(new Animated.Value(1));
  const [transitioning, setTransitioning] = useState(false);
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null);
  const [previousRisks, setPreviousRisks] = useState<Set<string>>(new Set());

  const resetChecklistState = useCallback(() => {
    setResponses({});
    setItemFiles({});
    setItemVideos({});
    setGeneralRemark('');
    setTimeIn(nowTime());
    setTimeOut('');
    setCurrentPage(1);
    setTriggeredRedItems(new Set());
    setYellowCount(0);
    setYellowAlertSent(false);
    setItemRemarkToggles({});
    setRemarksExpanded(false);
    setActiveInspectionId(null);
    setInspectionActive(false);
    setHighlightedPage(null);
    lastTriggeredRedResponse.current = {};
    if (items.length > 0) {
      const init: Record<string, { response: string | null; remark: string }> = {};
      items.forEach((i) => {
        init[i.id] = { response: null, remark: '' };
      });
      setResponses(init);
    }
  }, [items]);

  const loadInspectionResponses = useCallback(
    async (inspectionId: string) => {
      const { data, error } = await supabase
        .from('inspection_responses')
        .select('checklist_item_id, response, remarks')
        .eq('inspection_id', inspectionId);
      if (error || !data?.length) return;
      const loaded: Record<string, { response: string | null; remark: string }> = {};
      items.forEach((i) => {
        loaded[i.id] = { response: null, remark: '' };
      });
      data.forEach((row) => {
        loaded[row.checklist_item_id] = {
          response: row.response,
          remark: row.remarks ?? '',
        };
      });
      setResponses(loaded);
    },
    [items],
  );

  const [triggeredRedItems, setTriggeredRedItems] = useState<Set<string>>(new Set());
  const [yellowCount, setYellowCount] = useState(0);
  const [yellowAlertSent, setYellowAlertSent] = useState(false);

  const [activeInspectionId, setActiveInspectionId] = useState<string | null>(null);
  const [inspectionActive, setInspectionActive] = useState(false);
  const [itemRemarkToggles, setItemRemarkToggles] = useState<Record<string, boolean>>({});
  const [remarksExpanded, setRemarksExpanded] = useState(false);
  const { pingCount } = useLocationPing({ inspectionId: activeInspectionId, isActive: inspectionActive });

  const showToast = (message: string, type: 'success' | 'error' | 'warning') =>
    setToast({ visible: true, message, type });

  const toggleRemarkVisibility = (itemId: string) => {
    setItemRemarkToggles((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const isRemarkVisible = (itemId: string) => !!itemRemarkToggles[itemId];

  const resolveRiskBadge = (risk_level?: 'RED' | 'YELLOW' | 'GREEN') => {
    if (risk_level === 'RED') return { backgroundColor: '#fef2f2', color: '#dc2626', label: 'RED' };
    if (risk_level === 'YELLOW') return { backgroundColor: '#fffbeb', color: '#d97706', label: 'YELLOW' };
    return { backgroundColor: '#f0fdf4', color: '#16a34a', label: 'GREEN' };
  };

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('checklist_templates')
        .select(`
          id, section, item_text, item_order, risk_level, trigger_on_no, options, option_colors,
          risk_classifications:risk_classifications!risk_classifications_checklist_item_id_fkey (
            risk_level, trigger_on_no
          )
        `)
        .eq('is_active', true)
        .order('item_order');

      if (error) {
        const fallback = await supabase
          .from('checklist_templates')
          .select('id, section, item_text, item_order, risk_level, trigger_on_no, options')
          .eq('is_active', true)
          .order('item_order');
        if (fallback.data) hydrateItems(fallback.data as ChecklistTemplateRow[]);
        setLoading(false);
        return;
      }

      hydrateItems(data as ChecklistTemplateRow[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!branchId) return;
    resetChecklistState();
    void getPreviousRiskItems(branchId).then(setPreviousRisks);
  }, [branchId, resetChecklistState]);

  useEffect(() => {
    if (!branchId || reopen !== '1' || !routeInspectionId || items.length === 0) return;
    void loadInspectionResponses(routeInspectionId);
  }, [branchId, reopen, routeInspectionId, items.length, loadInspectionResponses]);

  const hydrateItems = (rows: ChecklistTemplateRow[]) => {
    const mapped = rows.map((r) => {
      const rc = Array.isArray(r.risk_classifications)
        ? r.risk_classifications[0]
        : r.risk_classifications;
      return {
        id: r.id,
        section: r.section,
        item_text: r.item_text,
        item_order: r.item_order,
        risk_level: (rc?.risk_level ?? r.risk_level) as 'RED' | 'YELLOW' | 'GREEN' | undefined,
        trigger_on_no: rc?.trigger_on_no ?? r.trigger_on_no ?? false,
        options: Array.isArray(r.options) ? (r.options as string[]) : null,
        option_colors: normalizeOptionColorMap(r.option_colors),
      };
    });
    setItems(mapped);
    const sections = new Set(mapped.map((i) => i.section));
    setExpandedSections(sections);
    const init: Record<string, { response: string | null; remark: string }> = {};
    mapped.forEach((i) => {
      init[i.id] = { response: null, remark: '' };
    });
    setResponses(init);
  };

  useEffect(() => {
    if (!branchId) return;
    loadDraft(branchId, today).then((draft) => {
      if (draft) {
        Alert.alert('Resume Draft?', 'A saved draft was found for this branch today. Resume it?', [
          {
            text: 'Start Fresh',
            style: 'destructive',
            onPress: () => {
              void deleteDraft(branchId, today);
              resetChecklistState();
            },
          },
          {
            text: 'Resume', onPress: () => {
              setResponses(draft.responses as Record<string, { response: string | null; remark: string }>);
              setGeneralRemark(draft.generalRemark);
              setTimeIn(draft.timeIn || nowTime());
              setTimeOut(draft.timeOut);
              if (draft.itemFiles) setItemFiles(draft.itemFiles);
            },
          },
        ]);
      }
    });
  }, [branchId, resetChecklistState]);

  const sections = useMemo(() => {
    const map: Record<string, ChecklistItem[]> = {};
    items.forEach((item) => {
      if (!map[item.section]) map[item.section] = [];
      map[item.section].push(item);
    });
    return map;
  }, [items]);

  const answeredCount = useMemo(
    () => Object.values(responses).filter((r) => r.response !== null).length,
    [responses]
  );

  useEffect(() => {
    if (!branchId) return;
    if (routeInspectionId) {
      setActiveInspectionId(routeInspectionId);
      setInspectionActive(true);
      return;
    }
    void (async () => {
      const arrivalTime = nowTime();
      const claim = await claimBranchInspection(branchId, arrivalTime);
      if (claim.inspectionId) {
        setActiveInspectionId(claim.inspectionId);
        setInspectionActive(true);
        setTimeIn(arrivalTime);
        supabase
          .from('inspections')
          .update({ time_in: arrivalTime })
          .eq('id', claim.inspectionId)
          .eq('status', 'draft')
          .then(({ error }) => {
            if (__DEV__ && error) console.warn('[checklist] Could not persist time_in:', error.message);
          });
      } else {
        Alert.alert('Store unavailable', claim.message, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    })();
  }, [branchId, routeInspectionId, router]);

  const ensureInspection = useCallback(async (): Promise<string | null> => {
    if (activeInspectionId) return activeInspectionId;
    if (routeInspectionId) {
      setActiveInspectionId(routeInspectionId);
      setInspectionActive(true);
      return routeInspectionId;
    }
    if (!branchId) return null;
    // Use the same idempotent RPC as the initial mount claim.
    // A direct INSERT would conflict with the unique constraint
    // (one draft per branch per day) that claim_branch_inspection enforces.
    const claim = await claimBranchInspection(branchId, nowTime());
    if (claim.inspectionId) {
      setActiveInspectionId(claim.inspectionId);
      setInspectionActive(true);
      return claim.inspectionId;
    }
    showToast('Could not initialise inspection for escalation', 'error');
    return null;
  }, [activeInspectionId, routeInspectionId, branchId]);

  const handleRedTriggered = useCallback(
    async (itemId: string) => {
      let firstTime = false;
      setTriggeredRedItems((prev) => {
        if (prev.has(itemId)) return prev;
        firstTime = true;
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });

      if (!firstTime) return;

      const inspId = await ensureInspection();
      if (!inspId) return;

      const redCount = triggeredRedItems.size + 1;

      supabase.functions
        .invoke('red-alert', {
          body: {
            inspection_id: inspId,
            checklist_item_id: itemId,
            officer_id: userRolesId,
            branch_id: branchId,
            red_count: redCount,
          },
        })
        .catch(() => {
          showToast('Escalation alert queued — will retry in background', 'warning');
        });
    },
    [ensureInspection, triggeredRedItems, userRolesId, branchId],
  );


  const handleResponse = useCallback(
    (itemId: string, response: string | null) => {
      setResponses((prev) => {
        const previous = prev[itemId]?.response ?? null;
        const next = { ...prev, [itemId]: { ...prev[itemId], response } };

        const item = items.find((i) => i.id === itemId);
        const triggers = item && response ? isViolationResponse(response, item.trigger_on_no ?? true) : false;
        if (item?.risk_level === 'YELLOW') {
          const previouslyTriggered = isViolationResponse(previous, item.trigger_on_no ?? true);
          if (triggers && !previouslyTriggered) {
            setYellowCount((c) => c + 1);
          } else if (!triggers && previouslyTriggered) {
            setYellowCount((c) => Math.max(0, c - 1));
          }
        }

        if (item?.risk_level === 'RED' && response !== null) {
          if (triggers && lastTriggeredRedResponse.current[itemId] !== response) {
            lastTriggeredRedResponse.current[itemId] = response;
            handleRedTriggered(itemId);
          }
        }

        if (item && response && triggers) {
          setItemRemarkToggles((prev) => ({ ...prev, [itemId]: true }));
        }

        return next;
      });
    },
    [handleRedTriggered, items]
  );

  const handleRemark = useCallback((itemId: string, remark: string) => {
    setResponses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], remark } }));
  }, []);

  useEffect(() => {
    if (yellowCount < YELLOW_REALTIME_THRESHOLD || yellowAlertSent) return;
    setYellowAlertSent(true);
    (async () => {
      const inspId = await ensureInspection();
      if (!inspId) return;
      supabase.functions
        .invoke('red-alert', {
          body: {
            inspection_id: inspId,
            officer_id: userRolesId,
            branch_id: branchId,
            template: 'YELLOW_REALTIME',
            yellow_count: yellowCount,
          },
        })
        .catch(() => {
          // Non-fatal — the supervisor will see them on submit anyway.
        });
    })();
  }, [yellowCount, yellowAlertSent, ensureInspection, userRolesId, branchId]);


  const handleSaveDraft = async () => {
    await saveDraft(branchId, today, {
      branchId,
      branchName,
      branchType: branchType || '',
      date,
      timeIn,
      timeOut,
      responses: responses as DraftForm['responses'],
      generalRemark,
      itemFiles,
      savedAt: new Date().toISOString(),
      officerLat: officerLat ? parseFloat(officerLat) : null,
      officerLon: officerLon ? parseFloat(officerLon) : null,
    });
    showToast('Draft saved successfully', 'success');
  };

  const appendItemFiles = useCallback((itemId: string, incoming: ItemAttachment[]) => {
    setItemRemarkToggles((prev) => ({ ...prev, [itemId]: true }));
    setItemFiles((prev) => ({
      ...prev,
      [itemId]: [...(prev[itemId] ?? []), ...incoming],
    }));
  }, []);

  const removeItemFile = useCallback((itemId: string, uri: string) => {
    setItemFiles((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] ?? []).filter((f) => f.uri !== uri),
    }));
  }, []);

  const removeItemVideo = useCallback((itemId: string, uri: string) => {
    setItemVideos((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] ?? []).filter((v) => v.uri !== uri),
    }));
  }, []);

  const formatVideoDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const normalizeImageUri = useCallback(
    async (
      uri: string,
      fallbackName: string,
      base64Data?: string | null,
    ): Promise<{ uri: string; name: string } | null> => {
      const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      const fileName = fallbackName.endsWith('.jpg') ? fallbackName : `${fallbackName}.jpg`;
      const targetPath = `${cacheDir}${fileName}`;

      // Samsung/high-res camera outputs can vary by URI scheme and metadata.
      // If base64 is available, persist directly to app cache first so preview + upload
      // always use a stable local file:// path independent of camera app behavior.
      if (base64Data) {
        try {
          await FileSystem.writeAsStringAsync(targetPath, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return { uri: targetPath, name: fileName };
        } catch {
          // continue into URI-based normalization
        }
      }

      try {
        const transformed = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 1600 } }],
          { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: false },
        );
        if (transformed.uri?.startsWith('file://')) {
          return { uri: transformed.uri, name: fileName };
        }
      } catch {
        // fall through to alternate local-path fallbacks
      }

      if (uri.startsWith('file://')) {
        try {
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await FileSystem.writeAsStringAsync(targetPath, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return { uri: targetPath, name: fileName };
        } catch {
          // If we cannot re-write the file, keep the original local path.
          return { uri, name: fileName };
        }
      }

      if (uri.startsWith('content://')) {
        try {
          await FileSystem.copyAsync({ from: uri, to: targetPath });
          return { uri: targetPath, name: fileName };
        } catch {
          // continue to hard failure
        }
      }
      return null;
    },
    [],
  );

  const uploadCapturedImages = useCallback(
    async (
      itemId: string,
      attachments: { uri: string; name: string; type: 'image' }[],
      successLabel: string,
    ) => {
      const inspId = await ensureInspection();
      if (!inspId) {
        showToast('Inspection not ready for photo upload', 'error');
        return;
      }

      appendItemFiles(
        itemId,
        attachments.map((file) => ({ ...file, uploading: true })),
      );

      let uploadedCount = 0;
      for (const attachment of attachments) {
        try {
          const uploaded = await uploadInspectionImageFile(
            attachment.uri,
            inspId,
            itemId,
            attachment.name,
          );
          uploadedCount += 1;
          setItemFiles((prev) => ({
            ...prev,
            [itemId]: (prev[itemId] ?? []).map((file) =>
              file.uri === attachment.uri
                ? {
                    ...file,
                    uploading: false,
                    fileUrl: uploaded.fileUrl,
                    name: uploaded.fileName,
                  }
                : file,
            ),
          }));
        } catch (err) {
          removeItemFile(itemId, attachment.uri);
          showToast(err instanceof Error ? err.message : 'Photo upload failed', 'error');
        }
      }

      if (uploadedCount > 0) {
        setItemRemarkToggles((prev) => ({ ...prev, [itemId]: true }));
        showToast(
          `${uploadedCount} ${successLabel}${uploadedCount === 1 ? '' : 's'} uploaded`,
          'success',
        );
      }
    },
    [appendItemFiles, ensureInspection, removeItemFile],
  );

  const pickCameraForItem = useCallback(
    async (itemId: string) => {
      try {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            'Camera permission needed',
            'Enable camera access to take photos for this inspection.',
          );
          return;
        }

        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.72,
          base64: true,
          exif: false,
        });
        if (result.canceled) return;
        if (!result.assets?.length) {
          showToast('No photo captured. Please try again.', 'warning');
          return;
        }

        const attachments = await Promise.all(
          result.assets.map(async (asset) => {
            if (!asset?.uri) return null;
            const normalized = await normalizeImageUri(
              asset.uri,
              `camera_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
              asset.base64,
            );
            if (!normalized) return null;
            return {
              uri: normalized.uri,
              name: asset.fileName || normalized.name,
              type: 'image' as const,
            };
          }),
        );
        const validAttachments = attachments.filter(
          (file): file is { uri: string; name: string; type: 'image' } => file !== null && !!file.uri,
        );
        if (!validAttachments.length) {
          showToast('Could not attach captured photo. Please retry.', 'error');
          return;
        }
        await uploadCapturedImages(itemId, validAttachments, 'camera photo');
      } catch {
        showToast('Camera capture failed. Please try again.', 'error');
      }
    },
    [normalizeImageUri, uploadCapturedImages],
  );

  const pickGalleryForItem = useCallback(
    async (itemId: string) => {
      try {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            'Gallery permission needed',
            'Enable photo library access to attach images for this inspection.',
          );
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          quality: 0.8,
        });
        if (result.canceled) return;
        const attachments = (
          await Promise.all(
            result.assets.map(async (asset) => {
              if (!asset?.uri) return null;
              const normalized = await normalizeImageUri(
                asset.uri,
                `gallery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
              );
              if (!normalized) return null;
              return {
                uri: normalized.uri,
                name: asset.fileName || normalized.name,
                type: 'image' as const,
              };
            }),
          )
        ).filter(
          (file): file is { uri: string; name: string; type: 'image' } => file !== null && !!file.uri,
        );
        if (!attachments.length) {
          showToast('Could not process selected image(s). Please try another photo.', 'warning');
          return;
        }
        await uploadCapturedImages(itemId, attachments, 'gallery photo');
      } catch {
        showToast('Gallery selection failed. Please try again.', 'error');
      }
    },
    [normalizeImageUri, uploadCapturedImages],
  );

  const uploadCapturedDocuments = useCallback(
    async (
      itemId: string,
      attachments: { uri: string; name: string; type: 'document' }[],
    ) => {
      const inspId = await ensureInspection();
      if (!inspId) {
        showToast('Inspection not ready for document upload', 'error');
        return;
      }

      appendItemFiles(
        itemId,
        attachments.map((file) => ({ ...file, uploading: true })),
      );

      let uploadedCount = 0;
      for (const attachment of attachments) {
        try {
          const uploaded = await uploadInspectionDocumentFile(
            attachment.uri,
            inspId,
            itemId,
            attachment.name,
          );
          uploadedCount += 1;
          setItemFiles((prev) => ({
            ...prev,
            [itemId]: (prev[itemId] ?? []).map((file) =>
              file.uri === attachment.uri
                ? {
                    ...file,
                    uploading: false,
                    fileUrl: uploaded.fileUrl,
                    name: uploaded.fileName,
                  }
                : file,
            ),
          }));
        } catch (err) {
          removeItemFile(itemId, attachment.uri);
          showToast(err instanceof Error ? err.message : 'Document upload failed', 'error');
        }
      }

      if (uploadedCount > 0) {
        setItemRemarkToggles((prev) => ({ ...prev, [itemId]: true }));
        showToast(
          `${uploadedCount} document${uploadedCount === 1 ? '' : 's'} uploaded`,
          'success',
        );
      }
    },
    [appendItemFiles, ensureInspection, removeItemFile],
  );

  const pickDocumentForItem = useCallback(
    async (itemId: string) => {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true });
      if (!result.canceled && result.assets.length > 0) {
        await uploadCapturedDocuments(
          itemId,
          result.assets.map((a) => ({
            uri: a.uri,
            name: a.name,
            type: 'document' as const,
          })),
        );
      }
    },
    [uploadCapturedDocuments],
  );

  const totalAttachmentCount = useMemo(
    () => Object.values(itemFiles).reduce((sum, list) => sum + list.length, 0),
    [itemFiles],
  );
  const evidenceReviewItems = useMemo(
    () =>
      Object.entries(itemFiles).flatMap(([itemId, files]) => {
        const itemText = items.find((item) => item.id === itemId)?.item_text ?? 'Checklist item';
        return files.map((file) => ({
          key: `${itemId}:${file.uri}`,
          itemText,
          file,
        }));
      }),
    [itemFiles, items],
  );

  const pageCount = useMemo(() => Math.ceil(items.length / ITEMS_PER_PAGE), [items.length]);
  const currentPageItems = useMemo(
    () => items.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE),
    [items, currentPage]
  );
  const currentPageComplete = useMemo(
    () =>
      currentPageItems.every((item) => {
        const r = responses[item.id]?.response;
        return r !== null && r !== undefined;
      }),
    [currentPageItems, responses],
  );
  const currentPageSections = useMemo(() => {
    const map: Record<string, ChecklistItem[]> = {};
    currentPageItems.forEach((item) => {
      if (!map[item.section]) map[item.section] = [];
      map[item.section].push(item);
    });
    return map;
  }, [currentPageItems]);
  const sectionsOnPage = useMemo(
    () => Object.keys(currentPageSections),
    [currentPageSections]
  );
  const firstUnansweredPage = useMemo(() => {
    const index = items.findIndex((item) => responses[item.id]?.response === null);
    return index === -1 ? null : Math.floor(index / ITEMS_PER_PAGE) + 1;
  }, [items, responses]);

  const progressPercent = useMemo(() => Math.round((answeredCount / (items.length || 1)) * 100), [answeredCount, items.length]);
  const isLastPage = currentPage === pageCount;
  const sectionAnsweredCount = useCallback(
    (section: string) => currentPageSections[section]?.filter((item) => responses[item.id]?.response !== null).length ?? 0,
    [responses, currentPageSections]
  );
  const sectionItemCount = useCallback(
    (section: string) => currentPageSections[section]?.length ?? 0,
    [currentPageSections]
  );

  const animatePage = useCallback(
    (nextPage: number) => {
      if (transitioning || nextPage < 1 || nextPage > pageCount || nextPage === currentPage) return;
      Keyboard.dismiss();
      setTransitioning(true);
      Animated.timing(pageOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setCurrentPage(nextPage);
        setHighlightedPage(null);
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        Animated.timing(pageOpacity, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }).start(() => setTransitioning(false));
      });
    },
    [currentPage, pageCount, pageOpacity, transitioning]
  );

  // AUTO-ADVANCE REMOVED PER CLIENT REQUEST
  // Officers must manually click Next to proceed to the next page

  const handleSubmit = async () => {
    const mediaUploading =
      Object.values(itemFiles).some((files) => files.some((file) => file.uploading)) ||
      Object.values(itemVideos).some((videos) => videos.some((video) => video.uploading));
    if (mediaUploading) {
      Alert.alert(
        'Upload in progress',
        'Please wait for camera and video uploads to finish before submitting.',
      );
      return;
    }

    const unanswered = items.filter((i) => responses[i.id]?.response === null);
    if (unanswered.length > 0) {
      const targetPage = firstUnansweredPage ?? 1;
      setHighlightedPage(targetPage);
      animatePage(targetPage);
      Alert.alert('Incomplete Inspection', `Please complete page ${targetPage} before submitting.`);
      return;
    }

    Alert.alert(
      'Submit Inspection',
      reopen === '1' || isEdit === '1'
        ? 'Save changes to this report? You can keep editing for up to 1 hour after the original submission.'
        : 'Submit this inspection? You will have 1 hour to edit after submitting.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          style: 'default',
          onPress: async () => {
            setSubmitting(true);
            const effectiveTimeOut = nowTime();
            const effectiveTimeIn = toValidTime(timeIn, effectiveTimeOut);
            if (effectiveTimeIn !== timeIn) setTimeIn(effectiveTimeIn);
            setTimeOut(effectiveTimeOut);
            const netState = await NetInfo.fetch();
            if (!netState.isConnected) {
              // If a RED already triggered while online, an inspections row
              // exists in draft state — pass its id so the offline queue can
              // UPDATE that row instead of inserting a duplicate.
              await queueInspection({
                branchId,
                branchName,
                branchType: branchType || '',
                date,
                timeIn: effectiveTimeIn,
                timeOut: effectiveTimeOut,
                responses: responses as DraftForm['responses'],
                generalRemark,
                itemFiles,
                savedAt: new Date().toISOString(),
                officerLat: officerLat ? parseFloat(officerLat) : null,
                officerLon: officerLon ? parseFloat(officerLon) : null,
                inspectionId: activeInspectionId ?? undefined,
                previousRiskItemIds: Array.from(previousRisks),
              });
              setSubmitting(false);
              showToast('Saved offline — will sync when connected', 'warning');
              return;
            }

            try {
              const inspectionId = await ensureInspection();
              if (!inspectionId) throw new Error('Inspection creation failed');

              const responseRows = items.map((item) => {
                const currentResponse = responses[item.id]?.response ?? null;
                const wasPreviouslyAtRisk = previousRisks.has(item.id);
                const resolvedThisInspection =
                  wasPreviouslyAtRisk &&
                  isCompliantResponse(currentResponse, item.trigger_on_no ?? true);
                return {
                  inspection_id: inspectionId,
                  checklist_item_id: item.id,
                  response: currentResponse,
                  remarks: responses[item.id]?.remark || null,
                  was_previously_at_risk: wasPreviouslyAtRisk,
                  resolved_this_inspection: resolvedThisInspection,
                };
              });
              const isReopening = reopen === '1' || isEdit === '1';
              if (isReopening) {
                const { error: clearRespErr } = await supabase
                  .from('inspection_responses')
                  .delete()
                  .eq('inspection_id', inspectionId);
                if (clearRespErr) throw new Error(clearRespErr.message);
              }

              const { error: respErr } = await supabase.from('inspection_responses').insert(responseRows);
              if (respErr) throw new Error(respErr.message);

              const uploadResult = await uploadInspectionFiles(inspectionId, itemFiles);
              if (uploadResult.errors.length > 0) {
                if (uploadResult.failedCount > 0 && uploadResult.successCount === 0) {
                  throw new Error(
                    uploadResult.errors[0] ??
                      `Failed to upload ${uploadResult.failedCount} photo(s). Please try again.`,
                  );
                } else if (uploadResult.failedCount > 0) {
                  // Some photos failed but some succeeded - warn but don't block submission
                  showToast(`${uploadResult.failedCount} photo(s) failed to upload but submission was recorded.`, 'warning');
                }
              }

              if (isReopening) {
                await supabase.from('general_remarks').delete().eq('inspection_id', inspectionId);
              }
              if (generalRemark.trim()) {
                await supabase.from('general_remarks').insert({
                  inspection_id: inspectionId,
                  remark_text: generalRemark.trim(),
                });
              }

              const submitAudit = await getDeviceAudit();
              const submittedAt = new Date().toISOString();
              const editWindowExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
              const { data: submittedRows, error: statusErr } = await supabase
                .from('inspections')
                .update({
                  status: 'submitted',
                  time_in: effectiveTimeIn,
                  time_out: effectiveTimeOut,
                  submitted_at: submittedAt,
                  edit_window_expires_at: editWindowExpiresAt,
                  ...(isReopening ? { edited_at: submittedAt, is_edited: true } : {}),
                  sync_status: 'synced',
                  device_id: submitAudit.deviceId,
                  app_version: submitAudit.appVersion,
                })
                .eq('id', inspectionId)
                .eq('status', 'draft')
                .select('id, status');

              if (statusErr) throw new Error(statusErr.message);
              if (!submittedRows?.length || submittedRows[0]?.status !== 'submitted') {
                throw new Error(
                  'Could not finalize submission. Your answers were saved — tap Submit again or contact support.',
                );
              }

              setInspectionActive(false);
              await deleteDraft(branchId, today);
              setSubmitting(false);

              router.replace({
                pathname: '/(officer)/confirm',
                params: {
                  inspectionId,
                  branchName,
                  branchType: branchType || '',
                  date,
                  timeIn: effectiveTimeIn,
                  timeOut: effectiveTimeOut,
                  answeredCount: String(answeredCount),
                  totalItems: String(items.length),
                  filesCount: String(totalAttachmentCount),
                },
              });
            } catch (e: unknown) {
              setInspectionActive(false);
              setSubmitting(false);
              showToast(e instanceof Error ? e.message : 'Submission failed. Please try again.', 'error');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' }}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={{ marginTop: 12, color: '#6b7280' }}>Loading checklist...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9', paddingTop: insets.top }}>
      <ToastMessage
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast((p) => ({ ...p, visible: false }))}
      />

      <View style={{ backgroundColor: '#1e3a5f', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: '#fff', marginHorizontal: 12 }} numberOfLines={1}>
          {branchName}
        </Text>
        <TouchableOpacity
          onPress={handleSaveDraft}
          style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Save Draft</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
      >
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 14,
            padding: 14,
            shadowColor: '#000',
            shadowOpacity: 0.06,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
            marginBottom: 12,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            <View>
              <Text style={{ fontSize: 13, color: '#6b7280' }}>Officer</Text>
              <Text style={{ fontSize: 13, color: '#111827', fontWeight: '600', marginTop: 2 }}>{userName}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 13, color: '#6b7280' }}>Date</Text>
              <Text style={{ fontSize: 13, color: '#111827', fontWeight: '600', marginTop: 2 }}>{date}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <View>
              <Text style={{ fontSize: 13, color: '#6b7280' }}>Time In</Text>
              <Text style={{ fontSize: 13, color: '#111827', fontWeight: '600', marginTop: 2 }}>{timeIn}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: '#6b7280' }}>Time Out</Text>
              <TextInput
                value={timeOut}
                onChangeText={setTimeOut}
                placeholder="HH:MM"
                placeholderTextColor="#9ca3af"
                style={{
                  marginTop: 2,
                  fontSize: 13,
                  color: '#111827',
                  borderBottomWidth: 1,
                  borderBottomColor: '#d1d5db',
                  paddingVertical: 2,
                }}
              />
            </View>
          </View>
        </View>

        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 16,
            padding: 16,
            shadowColor: '#000',
            shadowOpacity: 0.06,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
            marginBottom: 12,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ color: '#111827', fontSize: 13, fontWeight: '600' }}>Progress</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: progressPercent < 40 ? '#ef4444' : progressPercent < 80 ? '#f59e0b' : '#16a34a' }}>
              {progressPercent}%
            </Text>
          </View>
          <View style={{ height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
            <View style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: '#2563eb' }} />
          </View>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>{answeredCount} of {items.length} answered</Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1e3a5f' }}>{sectionsOnPage[0]}</Text>
          <View style={{ backgroundColor: '#eff6ff', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: '700' }}>
              Page {currentPage} of {pageCount}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {Array.from({ length: pageCount }, (_, idx) => {
            const page = idx + 1;
            const active = page === currentPage;
            const completed = page < currentPage;
            return (
              <View
                key={page}
                style={{
                  width: 28,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: completed ? '#16a34a' : active ? '#2563eb' : '#e2e8f0',
                }}
              />
            );
          })}
        </View>

        <Animated.View style={{ opacity: pageOpacity }}>
          {sectionsOnPage.map((section) => (
            <View key={section} style={{ marginBottom: 12 }}>
            <View
              style={{
                backgroundColor: '#1e3a5f',
                borderRadius: 12,
                padding: 14,
                marginBottom: 8,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{section}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                    {sectionAnsweredCount(section)}/{sectionItemCount(section)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#fff" />
              </View>
            </View>

            {currentPageSections[section].map((item) => {
              const badge = resolveRiskBadge(item.risk_level);
              const response = responses[item.id]?.response ?? null;
              const remark = responses[item.id]?.remark ?? '';
              const showRemark = isRemarkVisible(item.id);
              const triggerOnNo = item.trigger_on_no ?? true;
              const itemAttachments = itemFiles[item.id] ?? [];
              const itemVideoList = itemVideos[item.id] ?? [];
              const attachmentHint =
                itemAttachments.length + itemVideoList.length > 0
                  ? ` · ${itemAttachments.length + itemVideoList.length} file(s)`
                  : '';
              const hadPreviousRisk = previousRisks.has(item.id);

              return (
                <View
                  key={item.id}
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 16,
                    padding: 16,
                    marginBottom: 12,
                    shadowColor: '#000',
                    shadowOpacity: 0.06,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: 3,
                    ...(hadPreviousRisk
                      ? { borderWidth: 1.5, borderColor: '#ef4444', borderRadius: 8 }
                      : null),
                  }}
                >
                  {hadPreviousRisk ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        alignSelf: 'flex-start',
                        backgroundColor: 'rgba(239,68,68,0.10)',
                        borderColor: 'rgba(239,68,68,0.35)',
                        borderWidth: 1,
                        borderRadius: 99,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        marginBottom: 6,
                        gap: 4,
                      }}
                    >
                      <Ionicons name="warning-outline" size={12} color="#EF4444" />
                      <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: '500' }}>
                        Critical risk — verify on this visit
                      </Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ backgroundColor: badge.backgroundColor, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: badge.color }}>{badge.label}</Text>
                    </View>
                  </View>

                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', lineHeight: 22, marginVertical: 12 }}>
                    {item.item_text}
                  </Text>

                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    {(
                      item.options?.length
                        ? item.options.map((value: string) => ({ label: value.toUpperCase(), value }))
                        : isStaffBehaviourItem(item.item_text)
                          ? STAFF_BEHAVIOUR_OPTIONS
                          : [
                              { label: 'YES', value: 'Yes' as const },
                              { label: 'NO', value: 'No' as const },
                              { label: 'N/A', value: 'N/A' as const },
                            ]
                    ).map((button) => {
                      const active = response === button.value;
                      const knownValue =
                        button.value === 'Yes' ||
                        button.value === 'No' ||
                        button.value === 'N/A' ||
                        button.value === 'Good' ||
                        button.value === 'Moderate' ||
                        button.value === 'Bad';
                      const colors =
                        button.value === 'N/A'
                          ? optionHighlightButtonColors(
                              button.value,
                              response,
                              item.option_colors,
                              triggerOnNo,
                            )
                          : knownValue
                            ? optionHighlightButtonColors(
                                button.value,
                                response,
                                item.option_colors,
                                triggerOnNo,
                              )
                            : optionHighlightButtonColors(
                                button.value,
                                response,
                                item.option_colors,
                                triggerOnNo,
                              );
                      return (
                        <TouchableOpacity
                          key={button.value}
                          onPress={() => handleResponse(item.id, button.value)}
                          activeOpacity={0.75}
                          style={{
                            flex: 1,
                            borderRadius: 12,
                            paddingVertical: 12,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: active ? colors.activeBg : '#f8fafc',
                            borderWidth: 1.5,
                            borderColor: active ? colors.activeColor : '#e2e8f0',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: '700',
                              color: active ? colors.activeColor : colors.inactiveColor,
                            }}
                          >
                            {button.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TouchableOpacity onPress={() => toggleRemarkVisibility(item.id)} activeOpacity={0.75}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#2563eb' }}>
                      {showRemark
                        ? 'Hide remark and evidence'
                        : `+ Add remark or evidence (optional)${attachmentHint}`}
                    </Text>
                  </TouchableOpacity>

                  {showRemark && (
                    <View style={{ marginTop: 10 }}>
                      <TextInput
                        value={remark}
                        onChangeText={(text) => handleRemark(item.id, text)}
                        placeholder="Remark (optional)..."
                        placeholderTextColor="#9ca3af"
                        multiline
                        numberOfLines={3}
                        style={{
                          fontSize: 13,
                          color: '#111827',
                          borderBottomWidth: 1,
                          borderBottomColor: '#d1d5db',
                          paddingVertical: 8,
                        }}
                      />
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                        <TouchableOpacity
                          onPress={() => setVideoCaptureItemId(item.id)}
                          style={{
                            flex: 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            backgroundColor: '#fef2f2',
                            borderRadius: 10,
                            paddingVertical: 10,
                          }}
                        >
                          <Ionicons name="videocam-outline" size={16} color="#dc2626" />
                          <Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 12 }}>Video</Text>
                        </TouchableOpacity>
                      </View>
                      <ItemAttachments
                        compact
                        files={itemAttachments}
                        onAddCamera={() => void pickCameraForItem(item.id)}
                        onAddGallery={() => void pickGalleryForItem(item.id)}
                        onAddDocument={() => void pickDocumentForItem(item.id)}
                        onRemove={(uri) => removeItemFile(item.id, uri)}
                      />
                      {itemVideoList.length > 0 && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                          {itemVideoList.map((video) => (
                            <View key={video.uri} style={{ marginRight: 10, position: 'relative' }}>
                              <View
                                style={{
                                  width: 72,
                                  height: 72,
                                  borderRadius: 8,
                                  backgroundColor: '#1e293b',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {video.uploading ? (
                                  <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                  <>
                                    <Ionicons name="play-circle" size={28} color="#fff" />
                                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', marginTop: 4 }}>
                                      {formatVideoDuration(video.durationSeconds)}
                                    </Text>
                                  </>
                                )}
                              </View>
                              <TouchableOpacity
                                onPress={() => removeItemVideo(item.id, video.uri)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                style={{
                                  position: 'absolute',
                                  top: -6,
                                  right: -6,
                                  backgroundColor: '#dc2626',
                                  borderRadius: 10,
                                  width: 20,
                                  height: 20,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <Ionicons name="close" size={12} color="#fff" />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}
        </Animated.View>

        {isLastPage && (
          <View
            style={{
              backgroundColor: '#fff',
              borderRadius: 16,
              padding: 16,
              shadowColor: '#000',
              shadowOpacity: 0.06,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              elevation: 3,
              marginBottom: 16,
            }}
          >
            <TouchableOpacity
              onPress={() => setRemarksExpanded((prev) => !prev)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: remarksExpanded ? 12 : 0 }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>General Remarks (optional)</Text>
              <Ionicons name={remarksExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#2563eb" />
            </TouchableOpacity>
            {remarksExpanded && (
              <TextInput
                value={generalRemark}
                onChangeText={setGeneralRemark}
                placeholder="Overall observations for this visit..."
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={4}
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: 14,
                  padding: 12,
                  fontSize: 13,
                  color: '#111827',
                  minHeight: 90,
                }}
              />
            )}
          </View>
        )}

        {isLastPage && evidenceReviewItems.length > 0 && (
          <View
            style={{
              backgroundColor: '#fff',
              borderRadius: 16,
              padding: 16,
              shadowColor: '#000',
              shadowOpacity: 0.06,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              elevation: 3,
              marginBottom: 16,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>
              Evidence review before submit
            </Text>
            <Text style={{ marginTop: 4, marginBottom: 10, fontSize: 12, color: '#64748b' }}>
              Confirm each captured image/document before final submission.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {evidenceReviewItems.map(({ key, itemText, file }) => (
                <View key={key} style={{ width: 118, marginRight: 10 }}>
                  {file.type === 'image' ? (
                    <Image
                      source={{ uri: file.uri }}
                      style={{ width: 118, height: 92, borderRadius: 10, backgroundColor: '#e2e8f0' }}
                    />
                  ) : (
                    <View
                      style={{
                        width: 118,
                        height: 92,
                        borderRadius: 10,
                        backgroundColor: '#f1f5f9',
                        borderWidth: 1,
                        borderColor: '#e2e8f0',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="document-text-outline" size={22} color="#64748b" />
                      <Text
                        numberOfLines={1}
                        style={{ marginTop: 6, fontSize: 10, color: '#475569', paddingHorizontal: 6 }}
                      >
                        {file.name}
                      </Text>
                    </View>
                  )}
                  <Text
                    numberOfLines={2}
                    style={{ marginTop: 6, fontSize: 10, color: '#475569', lineHeight: 14 }}
                  >
                    {itemText}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 6,
          elevation: 8,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          <TouchableOpacity
            onPress={() => animatePage(currentPage - 1)}
            disabled={currentPage === 1 || transitioning}
            style={{
              flex: 1,
              minHeight: 52,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: '#e2e8f0',
              backgroundColor: '#fff',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#374151' }}>Previous</Text>
          </TouchableOpacity>
          {currentPage < pageCount ? (
            <TouchableOpacity
              onPress={() => animatePage(currentPage + 1)}
              disabled={!currentPageComplete || transitioning}
              style={{
                flex: 1,
                minHeight: 52,
                borderRadius: 14,
                backgroundColor: currentPageComplete ? '#2563eb' : '#93c5fd',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Next</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={submitting}
              style={{
                flex: 1,
                minHeight: 52,
                borderRadius: 14,
                backgroundColor: submitting ? '#93c5fd' : '#16a34a',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Submit Inspection</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
        <Text style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
          {currentPageComplete && currentPage < pageCount
            ? 'Page complete — tap Next to continue.'
            : 'Answer all items on this page to continue.'}
        </Text>
      </View>

      {videoCaptureItemId && (
        <VideoCapture
          onVideoCaptured={async (uri, durationSeconds) => {
            const capturedItemId = videoCaptureItemId;
            setItemVideos((prev) => ({
              ...prev,
              [capturedItemId]: [
                ...(prev[capturedItemId] ?? []),
                { uri, durationSeconds, uploading: true },
              ],
            }));
            setVideoCaptureItemId(null);
            try {
              const inspId = await ensureInspection();
              if (!inspId) throw new Error('Inspection not ready for video upload');
              const result = await uploadInspectionVideo(
                uri,
                inspId,
                capturedItemId,
                durationSeconds,
              );
              setItemVideos((prev) => {
                const list = [...(prev[capturedItemId] ?? [])];
                const idx = list.findIndex((v) => v.uri === uri);
                if (idx !== -1) {
                  list[idx] = { ...list[idx], ...result, uploading: false };
                }
                return { ...prev, [capturedItemId]: list };
              });
              setItemRemarkToggles((prev) => ({ ...prev, [capturedItemId]: true }));
              showToast('Video uploaded', 'success');
            } catch (e) {
              removeItemVideo(capturedItemId, uri);
              showToast(e instanceof Error ? e.message : 'Video upload failed', 'error');
            }
          }}
          onClose={() => setVideoCaptureItemId(null)}
        />
      )}
    </View>
  );
}
