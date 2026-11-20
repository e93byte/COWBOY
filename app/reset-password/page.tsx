import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPasswordForm } from "../components/AccountRecovery";

export const metadata: Metadata = { title: "Choose a new password — COWBOY" };

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordForm/></Suspense>;
}
