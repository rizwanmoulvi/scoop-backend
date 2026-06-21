async function main() {
  const jsonRpcModule = await import("@mysten/sui/jsonRpc");
  console.log(Object.keys(jsonRpcModule));
}

main().catch(console.error);