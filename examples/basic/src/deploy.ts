import { createDeployer } from '@deployinfra/sdk'
import { cloudflare } from '@deployinfra/cloudflare'
import { netlify } from '@deployinfra/netlify'
import { vercel } from '@deployinfra/vercel'
import { aws } from '@deployinfra/aws'
import { writeFile } from 'node:fs/promises'

async function main(): Promise<void> {

  const vercelProvider = vercel({
    token: "...",
  })

  const cloudflareProvider = cloudflare({
    accountId: "...",
    token: "...",
  })

  const netlifyProvider = netlify({
    token: "...",
  })

  const awsProvider = aws({
    region: "...",
    credentials: {
      accessKeyId: "...",
      secretAccessKey: "..."
    }
  })

  const deployer = createDeployer({
    provider: vercelProvider
  })

  const result = await deployer.deploy("./site", { name: "my-simple-example-app" })

  console.log({ url: result.url, domains: result.aliases })

  await writeFile("./deployment.json", JSON.stringify(result, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
