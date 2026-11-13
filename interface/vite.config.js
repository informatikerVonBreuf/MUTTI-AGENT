import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{sourcemap:false,rollupOptions:{output:{manualChunks(id){if(id.replaceAll('\\','/').includes('/node_modules/three/'))return 'reading-3d';}}}}});
