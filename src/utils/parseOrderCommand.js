function parseOrderCommand(text) {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .trim();

  const match = cleaned.match(/^(yes|no)\s+(\d+(\.\d+)?)(\s*(usdc|dusdc))?$/i);

  if (!match) {
    return {
      valid: false,
      error: "Invalid format. Use: Yes 5 USDC or No 5 USDC",
    };
  }

  const side = match[1].toUpperCase();
  const amount = Number(match[2]);

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      valid: false,
      error: "Amount must be greater than 0.",
    };
  }

  return {
    valid: true,
    side,
    amount,
    currency: "dUSDC",
  };
}

module.exports = {
  parseOrderCommand,
};
