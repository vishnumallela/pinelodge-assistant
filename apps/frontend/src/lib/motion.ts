export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const cardEntrance = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: EASE_OUT },
} as const;

export const rowEntrance = (i: number) => ({
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, delay: Math.min(i, 8) * 0.03, ease: EASE_OUT },
});
