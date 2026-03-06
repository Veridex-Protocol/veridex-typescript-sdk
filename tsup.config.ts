import { defineConfig } from 'tsup';

const sharedEntry = {
    'index': 'src/index.ts',
    'types': 'src/types.ts',
    'constants': 'src/constants.ts',
    'wormhole': 'src/wormhole.ts',
    'payload': 'src/payload.ts',
    'utils': 'src/utils.ts',
    'queries/index': 'src/queries/index.ts',
    'passkey': 'src/passkey.ts',
    'auth/prepareAuth': 'src/auth/prepareAuth.ts',
    'chains/evm/index': 'src/chains/evm/index.ts',
    'chains/solana/index': 'src/chains/solana/index.ts',
    'chains/aptos/index': 'src/chains/aptos/index.ts',
    'chains/sui/index': 'src/chains/sui/index.ts',
    'chains/starknet/index': 'src/chains/starknet/index.ts',
    'chains/stacks/index': 'src/chains/stacks/index.ts',
    'chains/avalanche/index': 'src/chains/avalanche/index.ts',
};

export default defineConfig([
    // ESM build — splitting: true so dynamic import() stays as real async import()
    // and @wormhole-foundation/wormhole-query-sdk is NOT hoisted to top-level scope.
    {
        entry: sharedEntry,
        format: ['esm'],
        dts: {
            compilerOptions: {
                skipLibCheck: true,
                noUnusedLocals: false,
                noUnusedParameters: false,
            },
        },
        splitting: true,
        sourcemap: true,
        clean: true,
        outDir: 'dist',
        external: [],
    },
    // CJS build — splitting not supported in CJS, but dynamic import() will be preserved
    // as require() calls that are lazily evaluated inside async functions.
    {
        entry: sharedEntry,
        format: ['cjs'],
        dts: false,
        splitting: false,
        sourcemap: true,
        clean: false, // don't wipe the ESM output
        outDir: 'dist',
        external: [],
    },
]);
