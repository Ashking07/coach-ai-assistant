export const T = {
  moss: '#7A8B6E',
  sunrise: '#E26A2C',
  amber: '#E2A13C',
  terracotta: '#C85A3E',
} as const;

export const darkVars = {
  '--bg': '#0E0F0C',
  '--panel': 'rgba(23, 24, 20, 0.5)',
  '--panel-solid': 'rgba(14, 15, 12, 0.92)',
  '--surface-sub': 'rgba(247, 243, 236, 0.04)',
  '--text': '#F7F3EC',
  '--muted': '#A8A49B',
  '--hairline': '#2A2B27',
} as const;

export const lightVars = {
  '--bg': '#F7F3EC',
  '--panel': '#FFFFFF',
  '--panel-solid': 'rgba(247, 243, 236, 0.94)',
  '--surface-sub': '#F1EBDF',
  '--text': '#0E0F0C',
  '--muted': '#6B6860',
  '--hairline': '#E6E1D7',
} as const;

export type ThemeVars = typeof darkVars;
