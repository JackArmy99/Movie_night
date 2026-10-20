import { allUsers } from "@/lib/session";
import { createPeople, pickUser } from "../actions";

export const dynamic = "force-dynamic";

// "Who's holding this phone?" — asked once per phone. The first time ever, it
// asks for both names instead.
export default async function Who() {
  const users = await allUsers();
  if (users.length < 2) {
    return (
      <main className="flex min-h-[80vh] flex-col justify-center gap-6">
        <div>
          <h1 className="text-3xl font-bold">Who's watching?</h1>
          <p className="mt-1 text-gray-400">
            Your two names. Each of you rates films separately; suggestions aim at films you'd both enjoy.
          </p>
        </div>
        <form action={createPeople} className="space-y-3">
          {users.length < 1 && (
            <input name="a" required placeholder="Your name" className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-lg" />
          )}
          <input
            name={users.length < 1 ? "b" : "a"}
            required
            placeholder={users.length < 1 ? "Your partner's name" : "The other name"}
            className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-lg"
          />
          <button className="btn-primary w-full">Continue</button>
        </form>
      </main>
    );
  }
  return (
    <main className="flex min-h-[80vh] flex-col justify-center gap-4">
      <h1 className="text-3xl font-bold">Whose phone is this?</h1>
      {users.map((u) => (
        <form key={u.id} action={pickUser.bind(null, u.id)}>
          <button className="btn-ghost w-full py-6 text-2xl">{u.name}</button>
        </form>
      ))}
    </main>
  );
}
