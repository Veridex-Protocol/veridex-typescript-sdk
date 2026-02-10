import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        'index': 'src/index.ts',
        'types': 'src/types.ts',
        'constants': 'src/constants.ts',
        'wormhole': 'src/wormhole.ts',
        'payload': 'src/payload.ts',
        'utils': 'src/utils.ts',
        'queries/index': 'src/queries/index.ts',
        'chains/evm/index': 'src/chains/evm/index.ts',
        'chains/solana/index': 'src/chains/solana/index.ts',
        'chains/aptos/index': 'src/chains/aptos/index.ts',
        'chains/sui/index': 'src/chains/sui/index.ts',
        'chains/starknet/index': 'src/chains/starknet/index.ts',
        'chains/stacks/index': 'src/chains/stacks/index.ts',
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
