import type { Metadata } from "next";
import { ForgotPasswordForm } from "../components/AccountRecovery";

export const metadata: Metadata = { title: "Reset password — COWBOY" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm/>;
}
