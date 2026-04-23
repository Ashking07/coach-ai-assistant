const COLORS = [
  '#7A8B6E', '#C47B3E', '#D4A840', '#B85C3A',
  '#6B8CAE', '#9B7BAE', '#5A8C7A', '#AE7B5A',
];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function KidAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const bg = colorFor(name);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg + '33',
        color: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter Tight, sans-serif',
        fontWeight: 600,
        fontSize: size * 0.38,
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </div>
  );
}
