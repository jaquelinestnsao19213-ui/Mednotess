/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // pdf.js tenta carregar "canvas" só no Node; no navegador não é preciso.
    config.resolve.alias = { ...config.resolve.alias, canvas: false, encoding: false };
    config.experiments = { ...config.experiments, topLevelAwait: true };
    return config;
  },
};

export default nextConfig;
