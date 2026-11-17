# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wenjinqin/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wenjinqin/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: 198 protocols that record no token yet, ranked by what a launch would be worth if the market priced them like their listed peers. The model is read off the snapshot itself — implied value = TVL × the category's median market-cap / TVL among the snapshot's own tokenised protocols, tilted by 7-day TVL momentum (clamped) and by years run tokenless (up to +30%). No outside prices, no hand-picked names. Every row carries a concrete farm plan with costs and time; tokens that already trade, and wrapped, staked or bridged products of them, are set aside in their own view with the reason for each. The dashboard is sortable and filterable, with a detail view per protocol that shows exactly how its value is built.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=d5a50dzy&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
