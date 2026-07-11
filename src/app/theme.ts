export const C = {
  bg: '#07080D',
  bgGrad: 'linear-gradient(135deg, #0F1728 0%, #07080D 100%)',
  card: '#111827',
  card2: '#1F2937',
  card3: '#273040',
  border: 'rgba(201,168,76,0.15)',
  borderBright: 'rgba(201,168,76,0.45)',
  borderSubtle: 'rgba(255,255,255,0.06)',
  goldGrad: 'linear-gradient(135deg, #C9A84C 0%, #8B6914 100%)',
  goldGradHov: 'linear-gradient(135deg, #E8C86A 0%, #C9A84C 100%)',
  gold: '#C9A84C',
  goldLight: '#E8C86A',
  goldDark: '#8B6914',
  goldDim: 'rgba(201,168,76,0.25)',
  text: '#F9FAFB',
  textSub: '#D1D5DB',
  textMuted: '#9CA3AF',
  textDim: '#6B7280',
  green: '#10B981',
  greenBg: 'rgba(16,185,129,0.12)',
  greenText: '#6EE7B7',
  greenBright: '#34D399',
  red: '#EF4444',
  redBg: 'rgba(239,68,68,0.12)',
  redText: '#FCA5A5',
  orange: '#F59E0B',
  orangeBg: 'rgba(245,158,11,0.12)',
  orangeText: '#FCD34D',
  blue: '#2563EB',
  blueBg: 'rgba(37,99,235,0.12)',
  blueText: '#93C5FD',
  purple: '#8B5CF6',
  purpleBg: 'rgba(139,92,246,0.12)',
  purpleText: '#C4B5FD',
  sidebarW: 240,
};

export const input = (extra?: string) =>
  `w-full px-3 py-2 rounded-lg outline-none transition-all ${extra ?? ''}`;

export const inputStyle = {
  background: '#1F2937',
  border: '1px solid rgba(201,168,76,0.2)',
  color: '#F9FAFB',
  fontSize: 14,
};

export const inputFocusStyle = {
  borderColor: 'rgba(201,168,76,0.6)',
  boxShadow: '0 0 0 2px rgba(201,168,76,0.1)',
};
