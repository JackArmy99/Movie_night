"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary w-full" disabled={pending}>
      {pending ? "Checking…" : "Come in"}
    </button>
  );
}

export default function Login() {
  const [state, action] = useFormState(login, {});
  return (
    <main className="flex min-h-[80vh] flex-col justify-center gap-6">
      <div className="text-center">
        <div className="text-6xl text-accent">★</div>
        <h1 className="mt-2 text-3xl font-bold">Movie Night</h1>
        <p className="mt-1 text-gray-400">Type your shared passcode. You only do this once per phone.</p>
      </div>
      <form action={action} className="space-y-3">
        <input
          name="passcode"
          type="password"
          autoComplete="current-password"
          placeholder="Passcode"
          className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-lg"
        />
        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        <Submit />
      </form>
    </main>
  );
}
