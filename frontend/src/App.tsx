import { useQuery } from '@tanstack/react-query'
import { Button } from './components/ui/button'

function App() {
  const apiUrl = import.meta.env.VITE_API_URL

  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: () =>
      fetch(new URL('/health', apiUrl)).then((r) => r.json()),
  })

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Coach Assistant</h1>
      <p>Backend says: {JSON.stringify(data)}</p>
      <Button>Click me</Button>
    </div>
  )
}

export default App
