"use client";

import { useState } from "react";

// ----------------------------------------------------------------------------
//  Password field with a reveal toggle.
//
//  The eye flips the input between type="password" and type="text". That is the
//  whole mechanism: it is a client-side convenience and nothing about it ever
//  reaches the API. Worth having because typing a password blind is the most
//  common reason a perfectly correct credential gets reported as "wrong
//  password" - and on this app a few of those in a row also trips the
//  per-account login backoff, so the user ends up locked out of their own
//  demo by a typo they could not see.
//
//  Layout trick: the WRAPPER owns the border, the input goes transparent
//  inside it. Same approach as .searchbox in globals.css. That keeps the eye
//  inside the field instead of pushing the field sideways to make room.
// ----------------------------------------------------------------------------

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minLength?: number;
  // "current-password" when signing in, "new-password" when registering:
  // it tells a password manager whether to offer a saved entry or a new one.
  autoComplete?: "current-password" | "new-password";
};

export default function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  minLength,
  autoComplete = "current-password",
}: Props) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Hide password" : "Show password";

  return (
    <div className="pwfield">
      <input
        id={id}
        type={visible ? "text" : "password"}
        required
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        // type="button" is load-bearing: a <button> inside a <form> defaults to
        // type="submit", so without this the eye would fire the login request.
        type="button"
        className="reveal"
        onClick={() => setVisible((v) => !v)}
        // The icon carries no text, so the button needs its own name for screen
        // readers. aria-pressed announces it as a toggle that is on or off.
        aria-label={label}
        aria-pressed={visible}
        title={label}
        // Not a tab stop: keyboard users tabbing email -> password -> Sign in
        // should not land on a decorative toggle in between. Still reachable
        // by click, and by keyboard via the browser's own controls.
        tabIndex={-1}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

// Inline SVG rather than an emoji or an icon package: emoji eyes render
// differently on every OS, and a 17px icon does not justify a dependency.
// stroke="currentColor" means the CSS hover colour drives the icon for free.

function EyeIcon() {
  return (
    <svg
      width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.7 17.7 0 0 1-2.8 3.7" />
      <path d="M6.6 6.6A17.2 17.2 0 0 0 2 12s3.6 7 10 7a10.7 10.7 0 0 0 5.4-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
