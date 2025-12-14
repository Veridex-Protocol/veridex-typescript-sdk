import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        'index': 'src/index.ts',
        'types': 'src/types.ts',
        'constants': 'src/constants.ts',
        'wormhole': 'src/wormhole.ts',
        'payload': 'src/payload.ts',
        'utils': 'src/utils.ts',
        'chains/evm/index': 'src/chains/evm/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: {
        compilerOptions: {
            skipLibCheck: true,
            noUnusedLocals: false,
            noUnusedParameters: false,
        },
    },
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    external: [],
});
