export function workspaceTheme(value) {
  const theme = value?.glassTheme ?? value?.theme;
  return theme === "dark" || ["dark-classic", "dark-ember", "dark-rose", "dark-emerald"].includes(theme) ? "dark-classic" : "light-classic";
}
