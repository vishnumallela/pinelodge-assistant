const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isE164 = (v: string) => v.trim() === "" || E164.test(v.trim());
export const isEmail = (v: string) => v.trim() === "" || EMAIL.test(v.trim());
