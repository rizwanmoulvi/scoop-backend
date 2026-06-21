async function main() {
  const clientModule = await import("@mysten/sui/client");
  console.log(Object.keys(clientModule));
}

main().catch(console.error);