import { useState } from "react";
import { net } from "../net";

const NAME_KEY = "ja.name";

export function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Landing({ roomId, error }: { roomId: string | null; error: string | null }) {
  const [name, setName] = useState(storedName);

  const go = () => {
    const n = name.trim();
    if (!n) return;
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      // Name just won't be remembered.
    }
    net.connect(n, roomId);
  };

  return (
    <div className="landing">
      <h1 className="logo">
        Junkyard
        <br />
        Armada
      </h1>
      <form
        className="landing-form"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <input
          autoFocus
          placeholder="Name"
          value={name}
          maxLength={16}
          onChange={(e) => setName(e.target.value)}
          aria-label="Name"
        />
        <button className="primary" type="submit" disabled={!name.trim()}>
          {roomId ? `Join ${roomId}` : "Create room"}
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
