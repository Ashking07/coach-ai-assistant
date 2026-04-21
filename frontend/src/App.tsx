import { useQuery } from '@tanstack/react-query'
import { Button } from './components/ui/button'

function App() {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: () => fetch('http://localhost:3000/health').then((r) => r.json()),
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
