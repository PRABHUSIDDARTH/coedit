// Tailwind v4 under webpack. (The scaffold's Turbopack loader only runs under Turbopack, which
// cannot resolve packages on this NTFS checkout, so dev and build use webpack.)
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
