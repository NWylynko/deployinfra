import { describeProviderE2e } from '../helpers/run-provider.ts'
import { loadAdapters } from '../helpers/providers.ts'

const adapters = await loadAdapters()
const adapter = adapters.find((a) => a.name === 'cloudflare')!
describeProviderE2e(adapter)
