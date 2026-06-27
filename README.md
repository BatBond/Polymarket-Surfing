# Polymarket Surfing - FABLE ELITE v6.0

Autonomous quantitative trading system for Polymarket and Kalshi.

## Deploy

1. Push to GitHub
2. Import repo on [Vercel](https://vercel.com/new)
3. Set Framework Preset to **Other**
4. Leave Build Command, Output Directory, and Install Command **empty**
5. Click Deploy

## Usage

1. Open the deployed URL
2. Configure strategies in Bot Control tab
3. Click **Start Bot**
4. Monitor trades in real-time across all tabs

## API Proxy

GET `/api/proxy?platform=poly-gamma&endpoint=markets?limit=50`

Platforms: `poly-clob`, `poly-gamma`, `poly-data`, `kalshi`

## License

MIT