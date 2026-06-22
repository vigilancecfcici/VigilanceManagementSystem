import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { AccountRequestModal } from '../components/auth/AccountRequestModal';
import { useAuth } from '../context/AuthContext';
import { homePathForRole } from '../lib/roleRoutes';
import { LegalFooter } from '../components/legal/LegalFooter';
import { COMPANY } from '../lib/legal/companyConfig';

export default function Login() {
  const { signIn, user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  // Redirect already-authenticated users (e.g. on page refresh with existing session)
  useEffect(() => {
    if (!loading && user && role) {
      const redirect = homePathForRole(role);
      if (redirect) navigate(redirect, { replace: true });
    }
  }, [user, role, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: err, role: r } = await signIn(email, password);

    if (err) {
      setError(err);
      setSubmitting(false);
      return;
    }

    // Navigate immediately — no need to wait for useEffect
    if (r === 'officer') {
      setError('This portal is for supervisors. Please use the mobile app.');
      setSubmitting(false);
      return;
    }

    const redirect = homePathForRole(r);
    if (redirect) {
      navigate(redirect, { replace: true });
    } else {
      setError('No dashboard access found for this account.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <img
            src="/logo.png"
            alt="CGC VMS"
            className="w-24 h-24 rounded-2xl mx-auto mb-4 object-cover shadow-lg"
          />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{COMPANY.platformAbbrev}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{COMPANY.platformName}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
              placeholder="your.work@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 transition pr-12"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {!loading && user && !role && !error && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded-lg px-4 py-3 text-sm">
              Signed in, but your dashboard role could not be loaded. Try signing in again or contact an admin.
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || loading}
            className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>

          <p className="text-center text-xs text-gray-500 dark:text-gray-400 pt-1">
            Contact your administrator to reset your password. Self-service email reset is not enabled.
          </p>

          <button
            type="button"
            onClick={() => setRequestOpen(true)}
            className="w-full py-2.5 text-sm font-medium text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-950/40 transition-colors"
          >
            Request account access
          </button>

          <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center leading-relaxed pt-2">
            By signing in, you confirm you are an authorised user and agree to the{' '}
            <Link to="/legal/terms" className="underline hover:text-gray-600 dark:hover:text-gray-300">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/legal/privacy" className="underline hover:text-gray-600 dark:hover:text-gray-300">
              Privacy Policy
            </Link>
            .
          </p>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 flex justify-center">
          <LegalFooter />
        </div>
      </div>

      <AccountRequestModal open={requestOpen} onClose={() => setRequestOpen(false)} />
    </div>
  );
}
