export function UserIdFooter({ uid }: { uid: string }) {
  return (
    <footer className="user-id">
      Your ID: <code>{uid}</code>
    </footer>
  );
}
