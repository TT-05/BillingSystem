export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`avatar ${small ? 'tiny' : ''}`}>
      {name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}
