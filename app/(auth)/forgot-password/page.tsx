"use client"

import Link from "next/link"

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF9F7] px-6">
      <div className="w-full max-w-md rounded-2xl border border-[#E7E5E4] bg-white p-6 text-center">
        <h1 className="text-2xl font-bold text-[#1C1917]">Forgot Password</h1>
        <p className="mt-3 text-sm text-[#78716C]">
          Password reset flow is being configured. Please contact your administrator to reset your account.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-medium text-white hover:bg-[#E55A24]"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  )
}

