# CreatorLock Middleware - Design Intentions

## Overview
CreatorLock is a trustless Escrow infrastructure on Solana designed for the Creator Economy. The interface is optimized for technical efficiency, mimicking the density and clarity of an IDE while maintaining a modern, high-fidelity aesthetic.

## Design Philosophy
- **Dark Mode First:** Deep slate grays provide a low-strain background for long sessions.
- **Neon Accents:** Cyan Neon is reserved strictly for primary actions and success states, ensuring clear visual hierarchy.
- **Density over Whitespace:** Information is packed tightly to provide a comprehensive overview without excessive scrolling, using Material 3 Expressive card structures with reduced padding.
- **Technical Typography:** Monospaced fonts are used for addresses, transaction IDs, and numeric values to emphasize the "infrastructure" nature of the tool.

## Component Specifications
### Header
- **Logo:** Minimalist lock icon + "CreatorLock".
- **Wallet Adapter:** Styled as a technical terminal button. Displays truncated Pubkey (e.g., `6pq...4xZ`) when connected.

### Main Dashboard (Single Page)
#### Left Panel: Maker Flow (Initialize Instruction)
- **Purpose:** Where sponsors lock funds.
- **Fields:** 
    - `Taker Pubkey`: Input for the creator's wallet.
    - `Amount`: USDC/wSOL selector + numeric input.
    - `Expiry`: Days to delivery.
- **PDA Preview:** A gray info card showing the predicted PDA address for transparency.
- **Primary CTA:** Large Cyan Neon button "Deposit to Escrow".

#### Right Panel: Taker/Auditor Flow (EscrowState)
- **Purpose:** On-chain state monitoring and resolution.
- **Status Indicators:** Color-coded chip (Active: Cyan, Resolved: Green, Canceled: Red).
- **Transaction Table:** Minimalist list showing Creator, Amount, State, and a Time-to-Deadline progress bar.
- **Resolution Actions:** "Release Funds" (Success/Green) and "Request Refund" (Warning/Red).

## Implementation Notes for Claude Code
- **Integration:** Use `@solana/web3.js` and `@solana/wallet-adapter-react`.
- **Logic:** Connect the "Deposit" button to the `initialize` instruction of the Anchor program.
- **State Management:** The Right Panel should poll or subscribe to the `EscrowState` account change.
- **Feedback:** Use the simulated Toast notification for transaction signatures.