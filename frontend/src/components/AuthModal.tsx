// AuthModal — sign in / sign up / magic-link UI panel.
// Shown inline (not a modal overlay) so it can be embedded anywhere.

import { type FC, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

interface Props {
  onClose?: () => void;
}

type Mode = "magic_link" | "password" | "signup";

const AuthModal: FC<Props> = ({ onClose }) => {
  const { signInWithEmail, signInWithPassword, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("magic_link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || (mode !== "magic_link" && !password)) return;
    setStatus("loading");
    setErrorMsg("");

    let result: { error: string | null };
    if (mode === "magic_link") {
      result = await signInWithEmail(trimmedEmail);
    } else if (mode === "signup") {
      result = await signUp(trimmedEmail, password);
    } else {
      result = await signInWithPassword(trimmedEmail, password);
    }

    if (result.error) {
      setStatus("error");
      setErrorMsg(result.error);
    } else {
      setStatus("success");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center space-y-3">
        <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-green-100">
          <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        {mode === "magic_link" ? (
          <>
            <h3 className="text-base font-semibold text-slate-800">Check your email</h3>
            <p className="text-sm text-slate-500">
              We sent a magic link to <strong>{email}</strong>. Click it to sign in.
            </p>
          </>
        ) : (
          <>
            <h3 className="text-base font-semibold text-slate-800">
              {mode === "signup" ? "Account created!" : "Signed in!"}
            </h3>
            <p className="text-sm text-slate-500">
              {mode === "signup"
                ? "Check your email to confirm your account."
                : "You're now signed in."}
            </p>
          </>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="text-sm text-indigo-600 hover:underline"
          >
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Sign in to Footnote</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Save and revisit your integrity reports across sessions.
        </p>
      </div>

      {/* Mode switcher */}
      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
        {(
          [
            { id: "magic_link" as Mode, label: "Magic Link" },
            { id: "password"   as Mode, label: "Password" },
            { id: "signup"     as Mode, label: "Sign Up" },
          ]
        ).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => { setMode(id); setStatus("idle"); setErrorMsg(""); }}
            className={`flex-1 py-2 text-center font-medium transition ${
              mode === id
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Email */}
      <div>
        <label htmlFor="auth-email" className="block text-sm font-medium text-slate-700 mb-1">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="you@university.edu"
          autoComplete="email"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
            focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>

      {/* Password (only for password / signup modes) */}
      {mode !== "magic_link" && (
        <div>
          <label htmlFor="auth-password" className="block text-sm font-medium text-slate-700 mb-1">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="••••••••"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
              focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {errorMsg}
        </p>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={status === "loading" || !email.trim()}
        className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white
          transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400
          focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === "loading" ? (
          "Loading…"
        ) : mode === "magic_link" ? (
          "Send Magic Link"
        ) : mode === "signup" ? (
          "Create Account"
        ) : (
          "Sign In"
        )}
      </button>
    </div>
  );
};

export default AuthModal;
