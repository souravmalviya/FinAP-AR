"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getUser, getToken, logout, SessionUser } from "@/lib/api";
import Logo from "@/components/Logo";

// Top bar: brand, navigation, and the logged-in user (name + role + logout).
// Also acts as the auth gate: no token -> redirect to /login.
export default function OrgHeader() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = pathname === "/login" || pathname === "/register";

  useEffect(() => {
    if (isPublic) return;
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setUser(getUser());
  }, [pathname, router, isPublic]);

  if (isPublic) return null; // auth pages have no chrome

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" || pathname.startsWith("/documents") : pathname.startsWith(href);

  return (
    <header className="topbar">
      <span className="brand">
        <Logo size={30} /> Verity
      </span>
      <nav>
        <Link href="/" className={isActive("/") ? "active" : ""}>Documents</Link>
        <Link href="/approvals" className={isActive("/approvals") ? "active" : ""}>Approvals</Link>
      </nav>
      {user && (
        <div className="org">
          {user.organizationName && <span className="orgname">{user.organizationName}</span>}
          <span className="whoami">
            <b>{user.name}</b>
            <i className={`rolechip r-${user.role}`}>{user.role.replace(/_/g, " ")}</i>
          </span>
          <button className="linkbtn" onClick={logout}>Sign out</button>
        </div>
      )}
    </header>
  );
}
