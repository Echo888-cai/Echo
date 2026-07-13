// Accessible toast surface subscribed to the shared toast channel.
// Same markup/classes (.toast / .is-visible) so 05-pages.css applies unmodified.
import { useEffect, useRef, useState } from "react";
import { subscribeToast } from "../lib/toast";

export function Toast() {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribeToast((next) => {
      setMessage(next);
      setVisible(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setVisible(false), 2200);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div id="toast" className={`toast ${visible ? "is-visible" : ""}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
