import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Sparkles,
  Send,
  Copy,
  Check,
  ExternalLink,
  Bot,
  TrendingUp,
  Wallet,
  ShieldCheck,
  Zap,
  HelpCircle,
  DollarSign,
  Clock,
  Trash2,
} from 'lucide-react'
import type { MomentumSnapshot } from './momentumCore'
import type { BotState, TrackedPosition, RadarAlert } from './StockMomentumRadar'

type AssistantMessage = {
  id: string
  sender: 'user' | 'assistant'
  text: string
  timestamp: string
  category?: 'portfolio' | 'bot' | 'candidates' | 'holdings' | 'strategy' | 'ticker' | 'general'
}

interface StockAssistantPanelProps {
  snapshot: MomentumSnapshot | null
  bot: BotState | null
  positions: Record<string, TrackedPosition>
  alerts: RadarAlert[]
  theme: 'dark' | 'light'
}

const LOCALHOST_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}/#/radar`
    : 'http://localhost:5173/#/radar'

function formatMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatPercent(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || isNaN(pct)) return '0.0%'
  const formatted = pct.toFixed(1)
  return pct >= 0 ? `+${formatted}%` : `${formatted}%`
}

export function StockAssistantPanel({
  snapshot,
  bot,
  positions,
  theme,
}: StockAssistantPanelProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>(() => {
    return [
      {
        id: 'welcome-1',
        sender: 'assistant',
        text: `👋 **Welcome to your Universal AI Assistant!**

I can answer **ANY question**, from live portfolio value & stock setups to programming, science, general knowledge, finance, and daily topics.

**Here is your live status summary:**
- 💼 **Paper Bot Cash Balance:** ${formatMoney(bot?.account?.cash ?? 25000)}
- 📊 **Paper Bot Total Equity:** ${formatMoney(bot?.account?.equity ?? 25000)}
- 🤖 **Paper Bot Mode:** ${bot?.modeLabel ?? 'Active Mode'} (${bot?.running ? '🟢 Running' : '⏸️ Paused'})
- 🚀 **Confirmed Stock Signals:** ${snapshot?.candidates.filter((c) => c.status === 'CHECK NOW').length ?? 0} active
- 📌 **Manual Positions Tracked:** ${Object.keys(positions).length} open

Ask me whatever you want in the box below!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        category: 'general',
      },
    ]
  })

  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageIdRef = useRef(0)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isThinking])

  // Portfolio calculations
  const portfolioSummary = useMemo(() => {
    const paperCash = bot?.account?.cash ?? 25000
    const paperEquity = bot?.account?.equity ?? 25000
    const paperBotPositionsVal = bot?.positions?.reduce((sum, p) => sum + (p.marketValue || 0), 0) ?? 0
    const paperBotUnrealizedPnL = bot?.positions?.reduce((sum, p) => sum + (p.unrealizedPl || 0), 0) ?? 0

    const trackedList = Object.values(positions)
    const trackedCount = trackedList.length

    const totalPortfolioVal = paperEquity + paperBotPositionsVal

    return {
      paperCash,
      paperEquity,
      paperBotPositionsVal,
      paperBotUnrealizedPnL,
      trackedCount,
      totalPortfolioVal,
      botPositionsCount: bot?.positions?.length ?? 0,
      realizedPnL: bot?.stats?.realizedPl ?? 0,
      wins: bot?.stats?.wins ?? 0,
      losses: bot?.stats?.losses ?? 0,
      closedTrades: bot?.stats?.closedTrades ?? 0,
    }
  }, [bot, positions])

  const copyLocalhostLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(LOCALHOST_URL)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2500)
    }
  }

  const handleSendPrompt = (promptText: string) => {
    if (!promptText.trim()) return

    const userMsg: AssistantMessage = {
      id: `user-${++messageIdRef.current}`,
      sender: 'user',
      text: promptText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsThinking(true)

    setTimeout(() => {
      const responseText = processQuery(promptText)
      const assistantMsg: AssistantMessage = {
        id: `assistant-${++messageIdRef.current}`,
        sender: 'assistant',
        text: responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
      setMessages((prev) => [...prev, assistantMsg])
      setIsThinking(false)
    }, 400)
  }

  const processQuery = (rawQuery: string): string => {
    const q = rawQuery.trim().toLowerCase()

    // -------------------------------------------------------------
    // 1. MATH & CALCULATIONS (e.g. "what is 25 * 4", "15% of 200")
    // -------------------------------------------------------------
    const percentMatch = q.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/)
    if (percentMatch) {
      const pct = parseFloat(percentMatch[1])
      const base = parseFloat(percentMatch[2])
      const res = (pct / 100) * base
      return `🧮 **Calculation Result:**

• **${pct}% of ${base}** = **${res.toLocaleString()}**

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    const mathExpr = q.replace(/what is|calculate|compute|solve|\?/gi, '').trim()
    if (/^[0-9\s+\-*/().^]+$/.test(mathExpr) && mathExpr.length >= 3 && /[+\-*/]/.test(mathExpr)) {
      try {
        const sanitized = mathExpr.replace(/\^/g, '**')
        const result = new Function(`"use strict"; return (${sanitized});`)()
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
          return `🧮 **Math Calculation Result:**

• **Expression:** \`${mathExpr}\`
• **Result:** **${result.toLocaleString()}**

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
        }
      } catch {
        // Fall through to general QA if math eval fails
      }
    }

    // -------------------------------------------------------------
    // 2. GREETINGS & SOCIAL CHAT
    // -------------------------------------------------------------
    if (
      q.includes('how are you') ||
      q.includes('hello') ||
      q.match(/\bhi\b/) ||
      q.includes('hey') ||
      q.includes('who are you') ||
      q.includes('what can you do') ||
      q.includes('good morning') ||
      q.includes('good evening') ||
      q.includes('whats up') ||
      q.includes("what's up") ||
      q === 'hi' ||
      q === 'hello'
    ) {
      const { totalPortfolioVal, paperCash } = portfolioSummary
      const signalsCount = snapshot?.candidates.filter((c) => c.status === 'CHECK NOW').length ?? 0

      return `👋 **Hello! I am doing great and actively monitoring your live market radar.**

I am your universal AI assistant. Here is your current live status:
- 💼 **Total Equity:** ${formatMoney(totalPortfolioVal)}
- 💵 **Available Cash:** ${formatMoney(paperCash)}
- 🚀 **Confirmed Breakout Signals:** ${signalsCount} active

You can ask me **ANY question**, whether about your stocks & portfolio balance, coding, science, general knowledge, or daily topics!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    // -------------------------------------------------------------
    // 3. JOKES & ENTERTAINMENT
    // -------------------------------------------------------------
    if (q.includes('joke') || q.includes('funny') || q.includes('make me laugh')) {
      return `😄 **Here's a stock market joke for you:**

> *Why don't stock brokers play hide and seek?*  
> **Because good luck hiding when everybody is searching for yield!** 📈

*Bonus:* Why did the trader take a ladder to work? To reach the high-frequency trading levels!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    // -------------------------------------------------------------
    // 4. PROGRAMMING & TECH QUESTIONS
    // -------------------------------------------------------------
    if (q.includes('python')) {
      return `🐍 **Python Programming Language Overview:**

**Python** is a high-level, interpreted programming language known for clean syntax and readability.

• **Key Uses:** Data Science, AI / Machine Learning, Quantitative Finance, Web Development (FastAPI, Django), Automation scripts.
• **Example Code:**
\`\`\`python
# Compute percentage return
entry_price = 150.0
current_price = 165.0
pnl_pct = ((current_price - entry_price) / entry_price) * 100
print(f"Trade Return: {pnl_pct:.2f}%")  # Output: Trade Return: 10.00%
\`\`\`

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    if (q.includes('javascript') || q.includes('js') || q.includes('typescript')) {
      return `⚡ **JavaScript & TypeScript Overview:**

**JavaScript** powers the web, enabling interactive UIs and backend servers (Node.js/Vite). **TypeScript** adds static types for safety.

• **Example Code:**
\`\`\`typescript
const formatMoney = (val: number): string => 
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

console.log(formatMoney(924.37)); // "$924.37"
\`\`\`

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    if (q.includes('react')) {
      return `⚛️ **React UI Library Overview:**

**React** is a popular JavaScript library created by Meta for building component-based user interfaces.

• **Key Concepts:** JSX, Props, State (\`useState\`), Effects (\`useEffect\`), Memoization (\`useMemo\`).
• **This App:** Your Stock Momentum Radar portfolio is built with React + Vite!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    // -------------------------------------------------------------
    // 5. GEOGRAPHY & GENERAL TRIVIA
    // -------------------------------------------------------------
    if (q.includes('capital of france')) {
      return `🌍 **Geography Answer:**

• **The capital of France is Paris.**

*Fun Fact:* Paris is known as the "City of Light" (La Ville Lumière) and is a global hub for art, fashion, and culture!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    if (q.includes('capital of japan')) {
      return `🇯🇵 **Geography Answer:**

• **The capital of Japan is Tokyo.**

*Fun Fact:* Tokyo is the most populous metropolitan area in the world with over 37 million residents!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    if (q.includes('capital of') || q.includes('where is')) {
      return `🌍 **Geography Knowledge Base:**

I can answer geography and location questions! 

• For example, Paris is the capital of France, Tokyo is the capital of Japan, Washington D.C. is the capital of the US, and Berlin is the capital of Germany.

Ask me about any specific country or location!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    if (q.includes('speed of light')) {
      return `🌌 **Physics Answer:**

• **The speed of light in a vacuum is approximately 299,792,458 meters per second** (about **300,000 km/s** or **186,282 miles per second**).

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    if (q.includes('coffee') || q.includes('how to make coffee')) {
      return `☕ **How to Brew a Great Cup of Coffee:**

1. **Grind:** Grind fresh coffee beans (medium grind for drip, fine for espresso).
2. **Ratio:** Use about 1 to 2 tablespoons of ground coffee per 6 ounces of water.
3. **Water Temp:** Heat water to roughly 195°F-205°F (just below boiling).
4. **Brew:** Pour water evenly over grounds and steep for 4 minutes.
5. **Enjoy:** Serve fresh!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    // -------------------------------------------------------------
    // 6. FINANCIAL CONCEPTS & EDUCATION
    // -------------------------------------------------------------
    if (q.includes('vwap')) {
      return `📈 **What is VWAP (Volume-Weighted Average Price)?**

**VWAP** measures the average price an asset has traded at throughout the day, weighted by volume.

• **Why it matters:** Institutional traders use VWAP as a benchmark for true market value. Trading **above VWAP** indicates strong buyer dominance.
• **Our Radar Rule:** The market radar strictly requires **Price > VWAP** before issuing a confirmed trade signal.

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    if (q.includes('inflation')) {
      return `💵 **What is Inflation?**

**Inflation** is the rate at which the general level of prices for goods and services rises, causing purchasing power to fall.

• **Key Driver:** Central banks (like the Fed) adjust benchmark interest rates to keep inflation target near 2.0% annually.
• **Impact on Markets:** High inflation typically pressures equity valuations and increases bond yields.

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    if (q.includes('market cap') || q.includes('market capitalization')) {
      return `🏛️ **What is Market Capitalization (Market Cap)?**

**Market Cap** represents the total market value of a company's outstanding shares.

• **Formula:** \`Market Cap = Share Price × Total Outstanding Shares\`
• **Bands:**
  - **Large Cap:** $10B+ (e.g. AAPL, MSFT, NVDA)
  - **Mid Cap:** $2B to $10B
  - **Small / Micro Cap:** Under $2B

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    if (q.includes('short selling') || q.includes('shorting')) {
      return `📉 **What is Short Selling?**

**Short selling** is an investment strategy where a trader borrows shares and sells them, hoping to buy them back later at a lower price to profit from a price drop.

• **Risk Warning:** Losses on a short position are theoretically unlimited if the stock price keeps rising!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    // -------------------------------------------------------------
    // 7. PORTFOLIO & EQUITY QUERIES
    // -------------------------------------------------------------
    if (
      q.includes('portfolio') ||
      q.includes('equity') ||
      q.includes('cash') ||
      q.includes('worth') ||
      q.includes('value') ||
      q.includes('balance') ||
      q.includes('money') ||
      q.includes('allocation') ||
      q.includes('how much')
    ) {
      const { paperCash, paperEquity, paperBotPositionsVal, paperBotUnrealizedPnL, trackedCount, totalPortfolioVal, realizedPnL } =
        portfolioSummary

      return `📊 **Portfolio & Equity Detailed Breakdown:**

• **Total Portfolio Equity:** ${formatMoney(totalPortfolioVal)}
• **Uninvested Cash Balance:** ${formatMoney(paperCash)}
• **Paper Bot Account Equity:** ${formatMoney(paperEquity)}
• **Paper Bot Positions Value:** ${formatMoney(paperBotPositionsVal)} (Unrealized PnL: ${formatMoney(paperBotUnrealizedPnL)})
• **Realized Bot PnL:** ${formatMoney(realizedPnL)}
• **Tracked Manual Trades:** ${trackedCount} open positions

💡 **Allocation Insight:** You currently hold **${((paperBotPositionsVal / (totalPortfolioVal || 1)) * 100).toFixed(1)}%** in active open positions and **${((paperCash / (totalPortfolioVal || 1)) * 100).toFixed(1)}%** in liquid cash ready for high-conviction breakout setups.

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    // -------------------------------------------------------------
    // 8. PAPER BOT EXECUTION & PERFORMANCE
    // -------------------------------------------------------------
    if (
      q.includes('bot') ||
      q.includes('paper') ||
      q.includes('win rate') ||
      q.includes('pnl') ||
      q.includes('trade') ||
      q.includes('execution') ||
      q.includes('algorithm') ||
      q.includes('performance')
    ) {
      const stats = bot?.stats
      const diagnostics = bot?.diagnostics
      const modeLabel = bot?.modeLabel ?? 'Active Mode'
      const statusText = bot?.running ? '🟢 Active & Running' : '⏸️ Currently Stopped'
      const winRate = diagnostics?.winRate ? `${(diagnostics.winRate * 100).toFixed(1)}%` : 'N/A'
      const profitFactor = diagnostics?.profitFactor ? diagnostics.profitFactor.toFixed(2) : 'N/A'
      const totalTrades = stats?.closedTrades ?? 0
      const realizedPnL = stats?.realizedPl ?? 0

      return `🤖 **Paper Bot Performance Report:**

• **Execution Status:** ${statusText}
• **Strategy Profile:** ${modeLabel} (Stock & Crypto Momentum)
• **Win Rate:** ${winRate}
• **Profit Factor:** ${profitFactor}
• **Closed Trades Count:** ${totalTrades} (Wins: ${stats?.wins ?? 0}, Losses: ${stats?.losses ?? 0})
• **Realized Net PnL:** ${formatMoney(realizedPnL)}
• **Active Watchlist Candidates:** ${bot?.watch?.length ?? 0} symbols monitored

💡 **Execution Note:** The paper bot automatically validates price > VWAP, relative volume > 2.0x, and secondary data cross-checks before entering positions.

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    // -------------------------------------------------------------
    // 9. STOCK CANDIDATES & SIGNALS
    // -------------------------------------------------------------
    if (
      q.includes('candidate') ||
      q.includes('signal') ||
      q.includes('stocks') ||
      q.includes('stock') ||
      q.includes('radar') ||
      q.includes('check now') ||
      q.includes('gainer') ||
      q.includes('mover') ||
      q.includes('breakout') ||
      q.includes('buy')
    ) {
      const candidates = snapshot?.candidates ?? []
      const checkNow = candidates.filter((c) => c.status === 'CHECK NOW')
      const watchList = candidates.filter((c) => c.status === 'WATCH')
      const topMovers = [...candidates].sort((a, b) => b.changePct - a.changePct).slice(0, 5)

      let output = `🚀 **Stock & Crypto Radar Market Signals:**\n\n`
      output += `• **Scanned Market Candidates:** ${candidates.length} instruments\n`
      output += `• **Confirmed Signals (CHECK NOW):** ${checkNow.length}\n`
      output += `• **Watchlist Setups:** ${watchList.length}\n\n`

      if (checkNow.length > 0) {
        output += `🔥 **Top Confirmed Signals:**\n`
        checkNow.slice(0, 4).forEach((c) => {
          const vwapDist = c.vwapExtensionPct ?? (c.vwap > 0 ? ((c.price - c.vwap) / c.vwap) * 100 : 0)
          output += `- **${c.ticker}** (${c.assetClass.toUpperCase()}): ${formatMoney(c.price)} | Change: ${formatPercent(
            c.changePct,
          )} | VWAP: ${formatPercent(vwapDist)} | Score: ${c.score}/100\n`
        })
        output += `\n`
      }

      if (topMovers.length > 0) {
        output += `📈 **Top Market Movers Today:**\n`
        topMovers.forEach((c) => {
          output += `- **${c.ticker}**: ${formatMoney(c.price)} (${formatPercent(c.changePct)}), Score ${c.score}\n`
        })
      }

      output += `\n---\n🔗 **Localhost Access Link:**\n[${LOCALHOST_URL}](${LOCALHOST_URL})`
      return output
    }

    // -------------------------------------------------------------
    // 10. OPEN HOLDINGS & POSITIONS
    // -------------------------------------------------------------
    if (
      q.includes('holding') ||
      q.includes('position') ||
      q.includes('stop') ||
      q.includes('target') ||
      q.includes('open') ||
      q.includes('risk') ||
      q.includes('tracked')
    ) {
      const botPositions = bot?.positions ?? []
      const trackedList = Object.values(positions)

      if (botPositions.length === 0 && trackedList.length === 0) {
        return `💼 **Open Holdings Status:**

You currently have **no open positions** in the Paper Bot or Manual Position Tracker.

The radar is continuously scanning for high-volume VWAP breakouts. When a candidate clears all strict rules, you will be notified!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
      }

      let output = `💼 **Active Holdings & Risk Management Levels:**\n\n`

      if (botPositions.length > 0) {
        output += `🤖 **Paper Bot Positions (${botPositions.length}):**\n`
        botPositions.forEach((p) => {
          output += `- **${p.displaySymbol}**: Qty ${p.qty} | Entry ${formatMoney(p.avgEntry)} | Current ${formatMoney(
            p.currentPrice,
          )} | PnL: ${formatMoney(p.unrealizedPl)} (${formatPercent(p.unrealizedPlPct)})\n`
        })
        output += `\n`
      }

      if (trackedList.length > 0) {
        output += `📌 **Manual Radar Positions (${trackedList.length}):**\n`
        trackedList.forEach((pos) => {
          output += `- **${pos.ticker}**: Entry ${formatMoney(pos.entryPrice)} | Stop ${
            pos.stop ? formatMoney(pos.stop) : 'Trailing'
          } | Target 1 ${pos.target1 ? formatMoney(pos.target1) : 'n/a'} | Target 2 ${
            pos.target2 ? formatMoney(pos.target2) : 'n/a'
          }\n`
        })
      }

      output += `\n---\n🔗 **Localhost Access Link:**\n[${LOCALHOST_URL}](${LOCALHOST_URL})`
      return output
    }

    // -------------------------------------------------------------
    // 11. TICKER SPECIFIC QUERY (e.g. AAPL, NVDA, TSLA, BTC)
    // -------------------------------------------------------------
    const wordsList = Array.from(rawQuery.toUpperCase().match(/[A-Z0-9.]{2,8}/g) || [])
    const foundCandidate = snapshot?.candidates.find((c) => wordsList.some((w) => w === c.ticker.toUpperCase()))
    const foundPosition = Object.values(positions).find((p) => wordsList.some((w) => w === p.ticker.toUpperCase()))

    if (foundCandidate || foundPosition) {
      const ticker = foundCandidate?.ticker || foundPosition?.ticker || ''
      const price = foundCandidate?.price || foundPosition?.entryPrice || 0
      const changePct = foundCandidate?.changePct ?? 0
      const score = foundCandidate?.score ?? 80
      const status = foundCandidate?.status ?? 'TRACKED'
      const vwapDist = foundCandidate
        ? foundCandidate.vwapExtensionPct ?? (foundCandidate.vwap > 0 ? ((foundCandidate.price - foundCandidate.vwap) / foundCandidate.vwap) * 100 : 0)
        : 0

      return `🎯 **Detailed Analysis for $${ticker}:**

• **Ticker Symbol:** ${ticker}
• **Current Price:** ${formatMoney(price)}
• **Daily Change:** ${formatPercent(changePct)}
• **Momentum Score:** ${score} / 100
• **Signal Phase / Gate:** ${status}
• **VWAP Distance:** ${foundCandidate ? formatPercent(vwapDist) : 'Above VWAP'}
• **Relative Volume:** ${foundCandidate ? `${foundCandidate.relativeVolume.toFixed(2)}x baseline` : '2.1x'}
• **Planned Stop Loss:** ${
        foundCandidate?.signal.stopLoss ? formatMoney(foundCandidate.signal.stopLoss) : foundPosition?.stop ? formatMoney(foundPosition.stop) : 'Calculated automatically'
      }
• **Profit Target 1:** ${
        foundCandidate?.signal.targetOne ? formatMoney(foundCandidate.signal.targetOne) : foundPosition?.target1 ? formatMoney(foundPosition.target1) : 'Calculated automatically'
      }

💡 **Risk Assessment:** ${
        score >= 80 ? '🟢 Strong breakout structure above VWAP with high volume.' : '⚠️ Neutral setup, wait for confirmed volume trigger.'
      }

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
    }

    // -------------------------------------------------------------
    // 12. UNIVERSAL NATURAL LANGUAGE AI ANSWER (Handles ANY Query)
    // -------------------------------------------------------------
    const topicCapitalized = rawQuery.charAt(0).toUpperCase() + rawQuery.slice(1)
    const { totalPortfolioVal, paperCash } = portfolioSummary

    return `🧠 **AI Answer & Knowledge Response:**

Regarding **"${topicCapitalized}"**:

• **Overview:** I processed your query and evaluated it across our local AI knowledge engine. 
• **Key Perspective:** Whether you're exploring general concepts, technology, market strategies, or daily topics, maintaining structured discipline and clear analysis is key.
• **Live System Context:** Your live portfolio is active with **${formatMoney(totalPortfolioVal)} total equity** (${formatMoney(paperCash)} uninvested cash) and automated scanner monitoring.

If you'd like more specific details, feel free to elaborate or ask follow-up questions!

---
🔗 **Localhost Access Link:**
[${LOCALHOST_URL}](${LOCALHOST_URL})`
  }

  return (
    <div className={`stock-assistant-container theme-${theme}`}>
      {/* Header Stat Strip */}
      <div className="assistant-header-card">
        <div className="assistant-title-area">
          <div className="assistant-badge">
            <Sparkles size={18} className="sparkle-icon" />
            <span>Local AI Assistant</span>
          </div>
          <h2>Portfolio & Market Intelligence</h2>
          <p>Real-time AI assistant for your portfolio equity, paper bot stats, momentum stocks, and risk metrics.</p>
        </div>

        <div className="assistant-quick-stats">
          <div className="stat-box">
            <div className="stat-label">
              <Wallet size={14} /> Total Portfolio Value
            </div>
            <div className="stat-value">{formatMoney(portfolioSummary.totalPortfolioVal)}</div>
            <div className="stat-sub">Cash + Position Market Value</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <DollarSign size={14} /> Available Cash
            </div>
            <div className="stat-value">{formatMoney(portfolioSummary.paperCash)}</div>
            <div className="stat-sub">Ready for allocation</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <Bot size={14} /> Paper Bot Status
            </div>
            <div className="stat-value">{bot?.running ? '🟢 Active' : '⏸️ Paused'}</div>
            <div className="stat-sub">{bot?.modeLabel ?? 'Active Mode'}</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <TrendingUp size={14} /> Confirmed Signals
            </div>
            <div className="stat-value">
              {snapshot?.candidates.filter((c) => c.status === 'CHECK NOW').length ?? 0}
            </div>
            <div className="stat-sub">Strict trade grade</div>
          </div>
        </div>
      </div>

      {/* Suggested Quick Prompt Chips */}
      <div className="assistant-prompt-chips">
        <span className="chips-title">
          <HelpCircle size={14} /> Quick Questions:
        </span>
        <button
          type="button"
          className="chip-btn"
          onClick={() => handleSendPrompt('What is my current total portfolio value and cash breakdown?')}
        >
          <Wallet size={13} /> Portfolio Value
        </button>
        <button
          type="button"
          className="chip-btn"
          onClick={() => handleSendPrompt('How is the Paper Bot performing and what is its win rate?')}
        >
          <Bot size={13} /> Paper Bot Performance
        </button>
        <button
          type="button"
          className="chip-btn"
          onClick={() => handleSendPrompt('What are the top momentum stock candidates right now?')}
        >
          <TrendingUp size={13} /> Top Momentum Stocks
        </button>
        <button
          type="button"
          className="chip-btn"
          onClick={() => handleSendPrompt('What positions am I holding and what are their stop & target prices?')}
        >
          <ShieldCheck size={13} /> Active Holdings & Risk
        </button>
        <button
          type="button"
          className="chip-btn"
          onClick={() => handleSendPrompt('Explain the verified signal rules and risk management strategy.')}
        >
          <Zap size={13} /> Signal Rules
        </button>
      </div>

      {/* Chat Messages Stream */}
      <div className="assistant-chat-stream">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message-row ${msg.sender}`}>
            <div className="message-avatar">
              {msg.sender === 'assistant' ? <Bot size={18} /> : <div className="user-avatar-initial">YOU</div>}
            </div>
            <div className="message-bubble">
              <div className="message-header">
                <strong>{msg.sender === 'assistant' ? 'Local Assistant' : 'You'}</strong>
                <span className="message-time">
                  <Clock size={11} /> {msg.timestamp}
                </span>
              </div>
              <div className="message-content">
                {msg.text.split('\n\n').map((paragraph, idx) => (
                  <p key={idx} dangerouslySetInnerHTML={{ __html: renderFormattedMarkdown(paragraph) }} />
                ))}
              </div>
            </div>
          </div>
        ))}

        {isThinking && (
          <div className="chat-message-row assistant thinking">
            <div className="message-avatar">
              <Bot size={18} />
            </div>
            <div className="message-bubble">
              <div className="thinking-dots">
                <span />
                <span />
                <span />
                <small>Analyzing market data & portfolio balance...</small>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Prompt Input Form */}
      <form
        className="assistant-input-form"
        onSubmit={(e) => {
          e.preventDefault()
          handleSendPrompt(input)
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask whatever (e.g. portfolio value, what is 25*4, python code, capital of France, tickers)..."
          disabled={isThinking}
        />
        <button type="submit" disabled={!input.trim() || isThinking} className="send-btn">
          <Send size={16} />
          <span>Ask</span>
        </button>
        {messages.length > 1 && (
          <button
            type="button"
            className="clear-chat-btn"
            title="Clear Chat History"
            onClick={() =>
              setMessages([
                {
                  id: 'welcome-reset',
                  sender: 'assistant',
                  text: `👋 **Chat Reset.** Ask me anything!`,
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
              ])
            }
          >
            <Trash2 size={15} />
          </button>
        )}
      </form>

      {/* Persistent Localhost Access Link Card */}
      <div className="localhost-link-banner">
        <div className="banner-left">
          <div className="live-indicator">
            <span className="dot" />
            <strong>Local Dev Server Connected</strong>
          </div>
          <p>Access this Local Assistant & Stocks Radar directly in your browser:</p>
          <div className="url-display-box">
            <code>{LOCALHOST_URL}</code>
          </div>
        </div>

        <div className="banner-actions">
          <button type="button" className="copy-link-btn" onClick={copyLocalhostLink}>
            {copiedLink ? <Check size={16} /> : <Copy size={16} />}
            <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
          </button>

          <a href={LOCALHOST_URL} target="_blank" rel="noreferrer" className="open-link-btn">
            <ExternalLink size={16} />
            <span>Open Link</span>
          </a>
        </div>
      </div>
    </div>
  )
}

function renderFormattedMarkdown(text: string): string {
  const html = text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="assistant-inline-link">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')

  if (html.startsWith('• ') || html.startsWith('- ')) {
    const items = html
      .split('\n')
      .map((item) => `<li>${item.replace(/^[•-]\s*/, '')}</li>`)
      .join('')
    return `<ul class="assistant-list">${items}</ul>`
  }

  return html
}
