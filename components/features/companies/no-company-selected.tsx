import { Building2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

interface NoCompanySelectedProps {
  message?: string
  description?: string
}

export function NoCompanySelected({ 
  message = "Aucune société sélectionnée",
  description = "Veuillez sélectionner une société pour continuer"
}: NoCompanySelectedProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-8 text-center">
          <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground font-medium mb-1">
            {message}
          </p>
          <p className="text-sm text-muted-foreground">
            {description}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
