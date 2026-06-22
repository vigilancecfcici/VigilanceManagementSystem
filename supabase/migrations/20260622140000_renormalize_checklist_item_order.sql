-- Renormalize checklist item_order to sequential 1..N after admin section drag
-- encoded orders as 1001, 2001, etc.

WITH section_rank AS (
  SELECT
    section,
    DENSE_RANK() OVER (ORDER BY MIN(item_order)) AS section_seq
  FROM public.checklist_templates
  WHERE is_active = true AND deleted_at IS NULL
  GROUP BY section
),
ordered AS (
  SELECT
    ct.id,
    ROW_NUMBER() OVER (
      ORDER BY sr.section_seq, ct.item_order, ct.created_at NULLS LAST, ct.id
    ) AS new_order
  FROM public.checklist_templates ct
  JOIN section_rank sr ON sr.section = ct.section
  WHERE ct.is_active = true AND ct.deleted_at IS NULL
)
UPDATE public.checklist_templates ct
SET item_order = o.new_order
FROM ordered o
WHERE ct.id = o.id;
