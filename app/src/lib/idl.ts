// Auto-generated from target/types/creator_lock.ts — keep in sync with the program.
export const PROGRAM_ID = "3XBXCwwN5CMGhjnV1CD94exPqPY4mL2LPifdzaowGmhw";

export const IDL = {
  address: PROGRAM_ID,
  metadata: { name: "creator_lock", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "initialize_and_deposit",
      discriminator: [207, 252, 149, 104, 12, 147, 170, 30],
      accounts: [
        { name: "maker", writable: true, signer: true },
        { name: "taker" },
        { name: "mint" },
        {
          name: "escrow_state",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [101, 115, 99, 114, 111, 119] },
              { kind: "account", path: "maker" },
            ],
          },
        },
        {
          name: "vault",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [118, 97, 117, 108, 116] },
              { kind: "account", path: "escrow_state" },
            ],
          },
        },
        { name: "maker_token_account", writable: true },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
        { name: "system_program", address: "11111111111111111111111111111111" },
        {
          name: "rent",
          address: "SysvarRent111111111111111111111111111111111",
        },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
    {
      name: "release",
      discriminator: [209, 117, 118, 81, 206, 4, 10, 116],
      accounts: [
        { name: "taker", writable: true, signer: true },
        { name: "maker", writable: true },
        {
          name: "escrow_state",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [101, 115, 99, 114, 111, 119] },
              { kind: "account", path: "maker" },
            ],
          },
        },
        { name: "token_mint" },
        {
          name: "vault",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [118, 97, 117, 108, 116] },
              { kind: "account", path: "escrow_state" },
            ],
          },
        },
        { name: "taker_token_account", writable: true },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [],
    },
    {
      name: "cancel_and_refund",
      discriminator: [85, 63, 7, 200, 113, 8, 53, 189],
      accounts: [
        { name: "maker", writable: true, signer: true },
        {
          name: "escrow_state",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [101, 115, 99, 114, 111, 119] },
              { kind: "account", path: "maker" },
            ],
          },
        },
        { name: "token_mint" },
        {
          name: "vault",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [118, 97, 117, 108, 116] },
              { kind: "account", path: "escrow_state" },
            ],
          },
        },
        { name: "maker_token_account", writable: true },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: "EscrowState",
      discriminator: [143, 247, 93, 202, 119, 199, 123, 70],
    },
  ],
  types: [
    {
      name: "EscrowState",
      type: {
        kind: "struct",
        fields: [
          { name: "maker", type: "pubkey" },
          { name: "taker", type: "pubkey" },
          { name: "token_mint", type: "pubkey" },
          { name: "amount", type: "u64" },
          { name: "bump", type: "u8" },
          { name: "vault_bump", type: "u8" },
        ],
      },
    },
  ],
  errors: [
    {
      code: 6000,
      name: "UnauthorizedTaker",
      msg: "Only the designated taker may release the funds",
    },
    { code: 6001, name: "InvalidMaker", msg: "Maker account mismatch" },
    {
      code: 6002,
      name: "MintMismatch",
      msg: "Token mint does not match the escrow",
    },
    {
      code: 6003,
      name: "ZeroAmount",
      msg: "Deposit amount must be greater than zero",
    },
  ],
} as const;
