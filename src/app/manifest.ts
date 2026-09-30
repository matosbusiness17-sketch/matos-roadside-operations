import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Matos Systems Roadside Worker',
    short_name: 'Roadside Worker',
    description: 'Mobile roadside response worker surface for Matos Systems.',
    start_url: '/worker',
    scope: '/worker',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0f172a',
    icons: [
      {
        src: '/worker-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
