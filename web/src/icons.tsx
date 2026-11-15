/** The mockup's SVG symbols, rendered once at the top of the app. */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <symbol id="i-fork" viewBox="0 0 24 24"><path d="M7.5 2.5v8a4.5 4.5 0 0 0 9 0v-8M12 15v4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="20.6" r="1.6" fill="currentColor" /></symbol>
      <symbol id="i-down" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></symbol>
      <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5h16v11H9.5L4 20z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></symbol>
      <symbol id="i-stand" viewBox="0 0 24 24"><path d="M4 3.5h16l-2.5 8h-11zM12 11.5v6M12 17.5l-5.5 4M12 17.5l5.5 4M12 17.5v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></symbol>
      <symbol id="i-books" viewBox="0 0 24 24"><path d="M3.5 4h4.5v16H3.5zM8 4h4.5v16H8zM12.5 5.4l3.8-1 3.9 14.7-3.8 1z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></symbol>
      <symbol id="i-tab" viewBox="0 0 24 24"><g stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h18M3 12h6M15 12h6M3 19h18" /></g><text x="12" y="15.6" fill="currentColor" fontFamily="'Jost',sans-serif" fontWeight="400" fontSize="10.5" textAnchor="middle">3</text></symbol>
      <symbol id="i-check" viewBox="0 0 12 12"><path d="M2 6.3 4.8 9 10 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></symbol>
      <symbol id="n-q" viewBox="0 0 36 28"><ellipse cx="16" cy="21" rx="4.3" ry="3.1" transform="rotate(-20 16 21)" fill="currentColor" /><path d="M19.9 20V6" stroke="currentColor" strokeWidth="2" /></symbol>
      <symbol id="n-8" viewBox="0 0 36 28"><ellipse cx="8" cy="22" rx="4.3" ry="3.1" transform="rotate(-20 8 22)" fill="currentColor" /><ellipse cx="25" cy="22" rx="4.3" ry="3.1" transform="rotate(-20 25 22)" fill="currentColor" /><path d="M11.9 21V7" stroke="currentColor" strokeWidth="2" /><path d="M28.9 21V7" stroke="currentColor" strokeWidth="2" /><path d="M10.9 8.6H29.9" stroke="currentColor" strokeWidth="3.2" /></symbol>
      <symbol id="n-3" viewBox="0 0 36 28"><ellipse cx="5" cy="23.5" rx="4.3" ry="3.1" transform="rotate(-20 5 23.5)" fill="currentColor" /><ellipse cx="16" cy="23.5" rx="4.3" ry="3.1" transform="rotate(-20 16 23.5)" fill="currentColor" /><ellipse cx="27" cy="23.5" rx="4.3" ry="3.1" transform="rotate(-20 27 23.5)" fill="currentColor" /><path d="M8.9 22.5V9.5" stroke="currentColor" strokeWidth="2" /><path d="M19.9 22.5V9.5" stroke="currentColor" strokeWidth="2" /><path d="M30.9 22.5V9.5" stroke="currentColor" strokeWidth="2" /><path d="M7.9 9.5H31.9" stroke="currentColor" strokeWidth="2.8" /><text x="18" y="6.8" fontSize="9.5" fontWeight="400" textAnchor="middle" fill="currentColor" fontFamily="'Jost',sans-serif">3</text></symbol>
      <symbol id="n-16" viewBox="0 0 36 28"><ellipse cx="8" cy="22" rx="4.3" ry="3.1" transform="rotate(-20 8 22)" fill="currentColor" /><ellipse cx="25" cy="22" rx="4.3" ry="3.1" transform="rotate(-20 25 22)" fill="currentColor" /><path d="M11.9 21V6.5" stroke="currentColor" strokeWidth="2" /><path d="M28.9 21V6.5" stroke="currentColor" strokeWidth="2" /><path d="M10.9 7.8H29.9" stroke="currentColor" strokeWidth="2.6" /><path d="M10.9 12.2H29.9" stroke="currentColor" strokeWidth="2.6" /></symbol>
    </svg>
  );
}

export type IconId = "i-fork" | "i-down" | "i-chat" | "i-stand" | "i-books" | "i-tab" | "i-check" | "n-q" | "n-8" | "n-3" | "n-16";

export function Icon({ id, className }: { id: IconId; className?: string }) {
  return (
    <svg aria-hidden="true" {...(className ? { className } : {})}>
      <use href={`#${id}`} />
    </svg>
  );
}
