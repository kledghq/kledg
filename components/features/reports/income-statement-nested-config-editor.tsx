'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ChevronRight, ChevronDown, Plus, Save, Trash2, Folder, FileText, Calculator, GripVertical, X } from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import type { IncomeStatementLineConfig } from '@/lib/reports/income-statement/types'

interface IncomeStatementNestedConfigEditorProps {
  configs: IncomeStatementLineConfig[]
  companyId: string
  reportVariant: 'complete' | 'simplified'
  onSave: (configs: IncomeStatementLineConfig[]) => Promise<void>
  onDelete: (configId: string) => Promise<void>
}

/**
 * Finds the root section (produits/charges) by traversing up the parent chain
 */
function findRootSection(
  config: IncomeStatementLineConfig,
  allConfigs: Map<string, IncomeStatementLineConfig>
): 'produits' | 'charges' | null {
  const label = config.lineLabel.toLowerCase()
  if (label.includes('produit') || label === 'produits') {
    return 'produits'
  }
  if (label.includes('charge') || label === 'charges') {
    return 'charges'
  }
  
  let current: IncomeStatementLineConfig | undefined = config
  while (current?.parentId) {
    const parent = allConfigs.get(current.parentId)
    if (!parent) break
    
    const parentLabel = parent.lineLabel.toLowerCase()
    if (parentLabel.includes('produit') || parentLabel === 'produits') {
      return 'produits'
    }
    if (parentLabel.includes('charge') || parentLabel === 'charges') {
      return 'charges'
    }
    
    current = parent
  }
  
  return null
}

/**
 * Flattens nested config structure to a flat array
 */
function flattenConfigs(configs: IncomeStatementLineConfig[]): IncomeStatementLineConfig[] {
  const result: IncomeStatementLineConfig[] = []
  
  function traverse(config: IncomeStatementLineConfig) {
    result.push(config)
    if (config.children) {
      for (const child of config.children) {
        traverse(child)
      }
    }
  }
  
  for (const config of configs) {
    traverse(config)
  }
  
  return result
}

export function IncomeStatementNestedConfigEditor({
  configs,
  companyId,
  reportVariant,
  onSave,
  onDelete,
}: IncomeStatementNestedConfigEditorProps) {
  const [editedConfigs, setEditedConfigs] = useState<IncomeStatementLineConfig[]>(configs)
  const [saving, setSaving] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setEditedConfigs(configs)
    // Auto-expand root nodes
    const rootIds = configs.filter(c => !c.parentId).map(c => c.id)
    setExpandedIds(new Set(rootIds))
  }, [configs])

  // Build config map for quick lookup
  const allConfigsFlat = useMemo(() => flattenConfigs(editedConfigs), [editedConfigs])
  const configMap = useMemo(() => {
    const map = new Map<string, IncomeStatementLineConfig>()
    for (const config of allConfigsFlat) {
      map.set(config.id, config)
    }
    return map
  }, [allConfigsFlat])

  // Separate produits and charges configs using explicit section field
  const { produitsConfigs, chargesConfigs } = useMemo(() => {
    const produits: IncomeStatementLineConfig[] = []
    const charges: IncomeStatementLineConfig[] = []
    
    for (const config of editedConfigs) {
      // Use explicit section field if available, otherwise fallback to findRootSection
      const section = config.section || findRootSection(config, configMap)
      if (section === 'produits') {
        produits.push(config)
      } else if (section === 'charges') {
        charges.push(config)
      } else {
        // Fallback: check if it's a root config and try to infer from order
        // Produits typically come first (lower order numbers)
        if (!config.parentId) {
          // If we can't determine, check the label more broadly
          const label = config.lineLabel.toLowerCase()
          if (label.includes('produit') || label.includes('vente') || label.includes('production') || label.includes('subvention')) {
            produits.push(config)
          } else if (label.includes('charge') || label.includes('achat') || label.includes('salair') || label.includes('amortissement')) {
            charges.push(config)
          } else {
            // Default: assume produits if order is low, charges if high
            // This is a fallback - ideally all configs should have section set
            if (config.order < 50) {
              produits.push(config)
            } else {
              charges.push(config)
            }
          }
        }
      }
    }
    
    // Sort by order
    produits.sort((a, b) => a.order - b.order)
    charges.sort((a, b) => a.order - b.order)
    
    return { produitsConfigs: produits, chargesConfigs: charges }
  }, [editedConfigs, configMap])

  const handleUpdate = (configId: string, updates: Partial<IncomeStatementLineConfig>) => {
    setEditedConfigs((prev) => {
      function updateInTree(config: IncomeStatementLineConfig): IncomeStatementLineConfig {
        if (config.id === configId) {
          return { ...config, ...updates }
        }
        if (config.children) {
          return {
            ...config,
            children: config.children.map(updateInTree),
          }
        }
        return config
      }
      return prev.map(updateInTree)
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(editedConfigs)
    } finally {
      setSaving(false)
    }
  }

  const handleAddGroup = async (parentId?: string | null, section: 'produits' | 'charges' = 'produits') => {
    // Find parent config to get max order
    let maxOrder = 1
    if (parentId) {
      const parent = configMap.get(parentId)
      if (parent?.children) {
        maxOrder = Math.max(...parent.children.map(c => c.order), 0) + 1
      }
    } else {
      // Root level - find max order in section
      const sectionConfigs = section === 'produits' ? produitsConfigs : chargesConfigs
      maxOrder = Math.max(...sectionConfigs.map(c => c.order), 0) + 1
    }

    // Determine section: use parent's section if parentId exists, otherwise use provided section
    let configSection: 'produits' | 'charges' | null = null
    if (parentId) {
      const parent = configMap.get(parentId)
      configSection = parent?.section || null
    } else {
      configSection = section as 'produits' | 'charges' | null
    }

    const newConfig = {
      companyId,
      reportVariant,
      parentId: parentId || null,
      section: configSection,
      lineLabel: 'Nouveau groupe',
      formCode: null,
      accountCodes: [],
      excludedAccountCodes: [],
      filterType: 'starts_with',
      filterValue: null,
      balanceType: 'auto' as const,
      order: maxOrder,
      notes: null,
    }

    try {
      const response = await fetch(`/api/companies/${companyId}/income-statement/config/line`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      })

      if (response.ok) {
        const created = await response.json()
        // Refresh configs - the parent component should reload
        toast.success('Groupe ajouté avec succès')
        window.location.reload() // Temporary: should use proper state update
      } else {
        const error = await response.json()
        toast.error(error.error || 'Erreur lors de l\'ajout du groupe')
      }
    } catch (error) {
      logger.error('Error adding group:', error)
      toast.error('Erreur lors de l\'ajout du groupe')
    }
  }

  const handleAddSum = async (parentId?: string | null, section: 'produits' | 'charges' = 'produits') => {
    let maxOrder = 1
    if (parentId) {
      const parent = configMap.get(parentId)
      if (parent?.children) {
        maxOrder = Math.max(...parent.children.map(c => c.order), 0) + 1
      }
    } else {
      const sectionConfigs = section === 'produits' ? produitsConfigs : chargesConfigs
      maxOrder = Math.max(...sectionConfigs.map(c => c.order), 0) + 1
    }

    // Determine section: use parent's section if parentId exists, otherwise use provided section
    let configSection: 'produits' | 'charges' | null = null
    if (parentId) {
      const parent = configMap.get(parentId)
      configSection = parent?.section || null
    } else {
      configSection = section as 'produits' | 'charges' | null
    }

    const newConfig = {
      companyId,
      reportVariant,
      parentId: parentId || null,
      section: configSection,
      lineLabel: 'Nouvelle somme',
      formCode: null,
      accountCodes: [],
      excludedAccountCodes: [],
      filterType: 'starts_with',
      filterValue: null,
      balanceType: 'auto' as const,
      order: maxOrder,
      notes: null,
    }

    try {
      const response = await fetch(`/api/companies/${companyId}/income-statement/config/line`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      })

      if (response.ok) {
        toast.success('Somme ajoutée avec succès')
        window.location.reload()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Erreur lors de l\'ajout de la somme')
      }
    } catch (error) {
      logger.error('Error adding sum:', error)
      toast.error('Erreur lors de l\'ajout de la somme')
    }
  }

  const handleAddLine = async (parentId?: string | null, section: 'produits' | 'charges' = 'produits') => {
    let maxOrder = 1
    if (parentId) {
      const parent = configMap.get(parentId)
      if (parent?.children) {
        maxOrder = Math.max(...parent.children.map(c => c.order), 0) + 1
      }
    } else {
      const sectionConfigs = section === 'produits' ? produitsConfigs : chargesConfigs
      maxOrder = Math.max(...sectionConfigs.map(c => c.order), 0) + 1
    }

    // Determine section: use parent's section if parentId exists, otherwise use provided section
    let configSection: 'produits' | 'charges' | null = null
    if (parentId) {
      const parent = configMap.get(parentId)
      configSection = parent?.section || null
    } else {
      configSection = section as 'produits' | 'charges' | null
    }

    const newConfig = {
      companyId,
      reportVariant,
      parentId: parentId || null,
      section: configSection,
      lineLabel: 'Nouvelle ligne',
      formCode: null,
      accountCodes: [],
      excludedAccountCodes: [],
      filterType: 'starts_with',
      filterValue: null,
      balanceType: section === 'produits' ? 'credit' as const : 'debit' as const,
      order: maxOrder,
      notes: null,
    }

    try {
      const response = await fetch(`/api/companies/${companyId}/income-statement/config/line`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      })

      if (response.ok) {
        toast.success('Ligne ajoutée avec succès')
        window.location.reload()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Erreur lors de l\'ajout de la ligne')
      }
    } catch (error) {
      logger.error('Error adding line:', error)
      toast.error('Erreur lors de l\'ajout de la ligne')
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Drag and drop handlers
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Find config and its parent in the tree, returning full configs with children
  const findConfigInTree = (
    configs: IncomeStatementLineConfig[],
    targetId: string,
    parentId: string | null = null
  ): { config: IncomeStatementLineConfig | null; parentId: string | null; siblings: IncomeStatementLineConfig[] } | null => {
    // Check if target is in this level
    const targetConfig = configs.find(c => c.id === targetId)
    if (targetConfig) {
      return { config: targetConfig, parentId, siblings: configs }
    }
    
    // Search in children
    for (const config of configs) {
      if (config.children) {
        const found = findConfigInTree(config.children, targetId, config.id)
        if (found) return found
      }
    }
    return null
  }

  // Track drag over state to determine if we should nest or reorder
  const [dragOverState, setDragOverState] = useState<{
    overId: string | null
    isNesting: boolean // true = make child, false = make sibling
  }>({ overId: null, isNesting: false })

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    
    if (!over || active.id === over.id) {
      setDragOverState({ overId: null, isNesting: false })
      return
    }

    // Get the over element's rect to determine mouse position
    const overElement = document.querySelector(`[data-sortable-id="${over.id}"]`) as HTMLElement
    if (!overElement) {
      setDragOverState({ overId: null, isNesting: false })
      return
    }

    const rect = overElement.getBoundingClientRect()
    
    // Try to get mouse position from the event
    let mouseY = rect.top + rect.height / 2
    if (event.activatorEvent && 'clientY' in event.activatorEvent) {
      mouseY = (event.activatorEvent as MouseEvent).clientY
    }
    
    // If mouse is in the bottom 40% of the element, nest as child
    // Otherwise, make it a sibling
    const isNesting = mouseY > rect.top + rect.height * 0.6
    
    setDragOverState({ overId: over.id as string, isNesting })
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    if (!over || active.id === over.id) {
      setDragOverState({ overId: null, isNesting: false })
      return
    }

    // Find both configs in the full tree
    const activeInfo = findConfigInTree(editedConfigs, active.id as string)
    const overInfo = findConfigInTree(editedConfigs, over.id as string)

    if (!activeInfo || !overInfo || !activeInfo.config || !overInfo.config) {
      setDragOverState({ overId: null, isNesting: false })
      return
    }

    // Prevent moving an item into its own descendants
    const isDescendant = (parentId: string | null, targetId: string): boolean => {
      if (!parentId) return false
      if (parentId === targetId) return true
      const parent = configMap.get(parentId)
      if (!parent || !parent.parentId) return false
      return isDescendant(parent.parentId, targetId)
    }

    if (isDescendant(overInfo.config.id, active.id as string)) {
      toast.error('Vous ne pouvez pas déplacer un élément dans ses propres descendants')
      setDragOverState({ overId: null, isNesting: false })
      return
    }

    // Determine if we should nest (make child) or reorder (make sibling)
    const shouldNest = dragOverState.overId === over.id && dragOverState.isNesting
    
    let newParentId: string | null
    let targetSiblings: IncomeStatementLineConfig[]
    let newIndex: number

    if (shouldNest) {
      // Make active a child of over
      newParentId = over.id as string
      const overChildren = overInfo.config.children || []
      targetSiblings = [...overChildren, activeInfo.config]
      newIndex = targetSiblings.length - 1
    } else {
      // Make active a sibling of over (same parent as over)
      newParentId = overInfo.parentId
      targetSiblings = overInfo.siblings.filter(s => s.id !== active.id)
      
      // Insert active at the position of over
      const overIndex = targetSiblings.findIndex(s => s.id === over.id)
      if (overIndex === -1) {
        targetSiblings.push(activeInfo.config)
        newIndex = targetSiblings.length - 1
      } else {
        targetSiblings.splice(overIndex, 0, activeInfo.config)
        newIndex = overIndex
      }
    }

    // Check if parent changed
    const parentChanged = activeInfo.parentId !== newParentId
    
    // Get the old index in current siblings
    const oldIndex = activeInfo.siblings.findIndex(c => c.id === active.id)
    
    if (oldIndex === -1) {
      setDragOverState({ overId: null, isNesting: false })
      return
    }

    // Build a map of all configs to get full structure with children
    const prevConfigsMap = new Map<string, IncomeStatementLineConfig>()
    const buildPrevConfigMap = (configs: IncomeStatementLineConfig[]) => {
      configs.forEach(config => {
        prevConfigsMap.set(config.id, config)
        if (config.children) {
          buildPrevConfigMap(config.children)
        }
      })
    }
    buildPrevConfigMap(editedConfigs)

    // Get the full active config with all its children
    const activeConfigFull = prevConfigsMap.get(active.id as string) || activeInfo.config

    // Update the tree structure immediately (optimistic update)
    setEditedConfigs(prev => {
      const prevConfigsMapInCallback = new Map<string, IncomeStatementLineConfig>()
      const buildPrevConfigMapInCallback = (configs: IncomeStatementLineConfig[]) => {
        configs.forEach(config => {
          prevConfigsMapInCallback.set(config.id, config)
          if (config.children) {
            buildPrevConfigMapInCallback(config.children)
          }
        })
      }
      buildPrevConfigMapInCallback(prev)

      const activeConfigFullInCallback = prevConfigsMapInCallback.get(active.id as string) || activeInfo.config

      // Function to remove a config from the tree
      const removeFromTree = (configs: IncomeStatementLineConfig[], idToRemove: string): IncomeStatementLineConfig[] => {
        return configs
          .filter(config => config.id !== idToRemove)
          .map(config => {
            if (config.children) {
              return {
                ...config,
                children: removeFromTree(config.children, idToRemove)
              }
            }
            return config
          })
      }

      // Function to add a config to the tree at a specific position
      const addToTree = (configs: IncomeStatementLineConfig[], configToAdd: IncomeStatementLineConfig, parentId: string | null, targetIndex: number): IncomeStatementLineConfig[] => {
        if (parentId === null) {
          const newConfig = {
            ...configToAdd,
            parentId: null,
            order: targetIndex + 1,
            children: configToAdd.children || []
          }
          const result = [...configs]
          result.splice(targetIndex, 0, newConfig)
          return result.map((c, i) => ({ ...c, order: i + 1 }))
        } else {
          return configs.map(config => {
            if (config.id === parentId) {
              const children = config.children || []
              const newChild = {
                ...configToAdd,
                parentId: parentId,
                order: targetIndex + 1,
                children: configToAdd.children || []
              }
              const newChildren = [...children]
              newChildren.splice(targetIndex, 0, newChild)
              const childrenWithOrder = newChildren.map((c, i) => ({ ...c, order: i + 1 }))
              return {
                ...config,
                children: childrenWithOrder
              }
            }
            if (config.children) {
              return {
                ...config,
                children: addToTree(config.children, configToAdd, parentId, targetIndex)
              }
            }
            return config
          })
        }
      }

      // First, remove the active config from its current position
      const removeFromTreeAndUpdateOrders = (configs: IncomeStatementLineConfig[], idToRemove: string, targetParentId: string | null): IncomeStatementLineConfig[] => {
        if (targetParentId === null) {
          const filtered = configs.filter(config => config.id !== idToRemove)
          return filtered.map((c, i) => ({
            ...c,
            order: i + 1,
            children: c.children ? removeFromTreeAndUpdateOrders(c.children, idToRemove, c.id) : c.children
          }))
        } else {
          return configs.map(config => {
            if (config.id === targetParentId) {
              const filtered = (config.children || []).filter(child => child.id !== idToRemove)
              const childrenWithOrder = filtered.map((c, i) => ({
                ...c,
                order: i + 1,
                children: c.children ? removeFromTreeAndUpdateOrders(c.children, idToRemove, c.id) : c.children
              }))
              return {
                ...config,
                children: childrenWithOrder
              }
            }
            if (config.children) {
              return {
                ...config,
                children: removeFromTreeAndUpdateOrders(config.children, idToRemove, targetParentId)
              }
            }
            return config
          })
        }
      }

      const treeAfterRemoval = removeFromTreeAndUpdateOrders(prev, active.id as string, activeInfo.parentId)
      
      // Then, add it to the new position (addToTree already updates orders)
      if (!activeConfigFullInCallback) {
        logger.warn('[Income Statement Config] activeConfigFullInCallback is null, cannot add to tree')
        setDragOverState({ overId: null, isNesting: false })
        return prev
      }
      
      const finalTree = addToTree(treeAfterRemoval, activeConfigFullInCallback, newParentId, newIndex)
      
      setDragOverState({ overId: null, isNesting: false })
      return finalTree
    })

    // Save to API in background
    try {
      // Update parentId if it changed
      if (parentChanged) {
        await updateConfigParent(active.id as string, newParentId)
      }
      
      // Update order for all target siblings
      const updatePromises = targetSiblings.map(async (config, index) => {
        const newOrder = index + 1
        await updateConfigOrder(config.id, newOrder)
      })

      await Promise.all(updatePromises)
      toast.success(parentChanged ? 'Niveau et ordre mis à jour' : 'Ordre mis à jour')
    } catch (error) {
      logger.error('Error updating config:', error)
      toast.error('Erreur lors de la mise à jour')
      setEditedConfigs(configs)
      setDragOverState({ overId: null, isNesting: false })
    }
  }

  const updateConfigOrder = async (configId: string, newOrder: number) => {
    try {
      const response = await fetch(
        `/api/companies/${companyId}/income-statement/config/line/${configId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: newOrder }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        logger.error('Error updating order:', error)
        throw new Error(error.error || 'Erreur lors de la mise à jour de l\'ordre')
      }
    } catch (error) {
      logger.error('Error updating order:', error)
      throw error
    }
  }

  const updateConfigParent = async (configId: string, newParentId: string | null) => {
    try {
      const response = await fetch(
        `/api/companies/${companyId}/income-statement/config/line/${configId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentId: newParentId }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        logger.error('Error updating parent:', error)
        throw new Error(error.error || 'Erreur lors de la mise à jour du parent')
      }
    } catch (error) {
      logger.error('Error updating parent:', error)
      throw error
    }
  }

  // Sortable item component
  const SortableItem = ({ 
    config, 
    section 
  }: { 
    config: IncomeStatementLineConfig
    section: 'produits' | 'charges'
  }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: config.id })

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    }

    const isExpanded = expandedIds.has(config.id)
    const hasChildren = config.children && config.children.length > 0
    // Determine lineType from balanceType and accountCodes
    const isGroup = config.balanceType === 'auto' && (config.accountCodes?.length || 0) === 0
    const isSum = config.balanceType === 'auto' && (config.accountCodes?.length || 0) > 0

    // Get children IDs for SortableContext
    const childrenIds = config.children?.map(c => c.id) || []

    return (
      <div ref={setNodeRef} style={style} className="space-y-2" data-sortable-id={config.id}>
        <div className="flex items-start gap-1">
          <div className="mt-1 flex items-center gap-1 max-sm:flex-col">
            <button
              {...attributes}
              {...listeners}
              className="pointer-coarse:size-11 inline-flex touch-none items-center justify-center p-1 hover:bg-muted rounded cursor-grab active:cursor-grabbing"
              title="Glisser pour réorganiser"
              aria-label="Glisser pour réorganiser"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </button>
            {hasChildren ? (
              <button
                onClick={() => toggleExpand(config.id)}
                aria-label={isExpanded ? 'Replier' : 'Déplier'}
                aria-expanded={isExpanded}
                className="pointer-coarse:size-11 inline-flex items-center justify-center p-1 hover:bg-muted rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            ) : (
              <div className="pointer-coarse:w-11 w-6" />
            )}
            {isGroup ? (
              <Folder aria-label="Groupe" className="text-muted-foreground size-4" />
            ) : isSum ? (
              <Calculator aria-label="Somme" className="text-muted-foreground size-4" />
            ) : (
              <FileText aria-label="Ligne" className="text-muted-foreground size-4" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <IncomeStatementLineConfigEditor
              config={config}
              onUpdate={(updates) => handleUpdate(config.id, updates)}
              onDelete={() => onDelete(config.id)}
              onAddGroup={() => handleAddGroup(config.id, section)}
              onAddSum={() => handleAddSum(config.id, section)}
              onAddLine={() => handleAddLine(config.id, section)}
              isGroup={isGroup}
              isSum={isSum}
              section={section}
            />
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="ml-2 space-y-2 border-l pl-2 sm:ml-6 sm:pl-4">
            <SortableContext items={childrenIds} strategy={verticalListSortingStrategy}>
              {config.children!.map((child) => (
                <SortableItem key={child.id} config={child} section={section} />
              ))}
            </SortableContext>
          </div>
        )}
      </div>
    )
  }

  const renderConfig = (config: IncomeStatementLineConfig, section: 'produits' | 'charges') => {
    return <SortableItem key={config.id} config={config} section={section} />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-prose text-sm">
          Glissez les lignes pour les réordonner, ouvrez une ligne pour choisir ses comptes. Enregistrez pour appliquer.
        </p>
        <Button onClick={handleSave} loading={saving}>
          <Save aria-hidden />
          Enregistrer
        </Button>
      </div>

      {/* Side by side layout */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          {/* PRODUITS Column */}
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Produits</h2>
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddGroup(null, 'produits')}
                >
                  <Folder aria-hidden />
                  Groupe
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddSum(null, 'produits')}
                >
                  <Calculator aria-hidden />
                  Somme
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddLine(null, 'produits')}
                >
                  <FileText aria-hidden />
                  Ligne
                </Button>
              </div>
            </div>
            <SortableContext 
              items={produitsConfigs.map(c => c.id)} 
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {produitsConfigs.map((config) => renderConfig(config, 'produits'))}
              </div>
            </SortableContext>
          </div>

          {/* CHARGES Column */}
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Charges</h2>
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddGroup(null, 'charges')}
                >
                  <Folder aria-hidden />
                  Groupe
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddSum(null, 'charges')}
                >
                  <Calculator aria-hidden />
                  Somme
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddLine(null, 'charges')}
                >
                  <FileText aria-hidden />
                  Ligne
                </Button>
              </div>
            </div>
            <SortableContext 
              items={chargesConfigs.map(c => c.id)} 
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {chargesConfigs.map((config) => renderConfig(config, 'charges'))}
              </div>
            </SortableContext>
          </div>
        </div>
      </DndContext>
    </div>
  )
}

interface IncomeStatementLineConfigEditorProps {
  config: IncomeStatementLineConfig
  onUpdate: (updates: Partial<IncomeStatementLineConfig>) => void
  onDelete: () => void
  onAddGroup: () => void
  onAddSum: () => void
  onAddLine: () => void
  isGroup: boolean
  isSum: boolean
  section: 'produits' | 'charges'
}

function IncomeStatementLineConfigEditor({
  config,
  onUpdate,
  onDelete,
  onAddGroup,
  onAddSum,
  onAddLine,
  isGroup,
  isSum,
  section,
}: IncomeStatementLineConfigEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [newAccountCode, setNewAccountCode] = useState('')
  const [newExcludedCode, setNewExcludedCode] = useState('')

  const accountCodes = config.accountCodes ?? []
  const excludedCodes = config.excludedAccountCodes ?? []

  const addAccountCode = (code: string) => {
    const trimmed = code.trim()
    if (trimmed && !accountCodes.includes(trimmed)) {
      onUpdate({ accountCodes: [...accountCodes, trimmed] })
      setNewAccountCode('')
    }
  }

  const removeAccountCode = (code: string) => {
    onUpdate({ accountCodes: accountCodes.filter((c) => c !== code) })
  }

  const addExcludedCode = (code: string) => {
    const trimmed = code.trim()
    if (trimmed && !excludedCodes.includes(trimmed)) {
      onUpdate({ excludedAccountCodes: [...excludedCodes, trimmed] })
      setNewExcludedCode('')
    }
  }

  const removeExcludedCode = (code: string) => {
    onUpdate({ excludedAccountCodes: excludedCodes.filter((c) => c !== code) })
  }

  const getTypeLabel = () => {
    if (isGroup) return 'Groupe'
    if (isSum) return 'Somme'
    return 'Ligne'
  }

  return (
    <Card className="gap-0 py-3">
      <CardContent className="px-3">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 basis-48">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={config.lineLabel}
                  onChange={(e) => onUpdate({ lineLabel: e.target.value })}
                  className="font-semibold text-sm"
                  placeholder="Libellé"
                />
                <Badge variant="muted">
                  {getTypeLabel()}
                </Badge>
                {config.formCode && (
                  <Badge variant="outline" className="font-mono">
                    {config.formCode}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {(isGroup || isSum) && (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onAddGroup}
                    aria-label="Ajouter un groupe"
                    title="Ajouter un groupe"
                  >
                    <Folder aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onAddSum}
                    aria-label="Ajouter une somme"
                    title="Ajouter une somme"
                  >
                    <Calculator aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onAddLine}
                    aria-label="Ajouter une ligne"
                    title="Ajouter une ligne"
                  >
                    <FileText aria-hidden />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Fermer les réglages de la ligne' : 'Ouvrir les réglages de la ligne'}
                title={isExpanded ? 'Fermer les réglages' : 'Réglages de la ligne'}
              >
                {isExpanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                className="hover:text-destructive"
                aria-label="Supprimer la ligne"
                title="Supprimer la ligne"
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>

          {isExpanded && (
            <div className="space-y-4 pt-2 border-t">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Libellé</Label>
                  <Input
                    value={config.lineLabel}
                    onChange={(e) => onUpdate({ lineLabel: e.target.value })}
                    placeholder="Libellé de la ligne"
                  />
                </div>

                {!config.parentId && (
                  <div>
                    <Label>Section</Label>
                    <Select
                      value={config.section || 'none'}
                      onValueChange={(value) => onUpdate({ section: value === 'none' ? null : value as 'produits' | 'charges' })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner une section" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="produits">Produits</SelectItem>
                        <SelectItem value="charges">Charges</SelectItem>
                        <SelectItem value="none">Aucune (héritée du parent)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Section du compte de résultat (uniquement pour les lignes racines)
                    </p>
                  </div>
                )}

                <div>
                  <Label>Code formulaire</Label>
                  <Input
                    value={config.formCode || ''}
                    onChange={(e) => onUpdate({ formCode: e.target.value || null })}
                    placeholder="FA, FD, FG..."
                  />
                </div>

                {(isSum || !isGroup) && (
                  <>
                    <div className="space-y-2">
                      <Label>Comptes inclus</Label>
                      <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-input bg-background min-h-10">
                        {accountCodes.map((code) => (
                          <Badge
                            key={code}
                            variant="secondary"
                            className="font-mono gap-1 pr-1"
                          >
                            {code}
                            <button
                              type="button"
                              onClick={() => removeAccountCode(code)}
                              className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                              aria-label={`Retirer ${code}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                        <Input
                          value={newAccountCode}
                          onChange={(e) => setNewAccountCode(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addAccountCode(newAccountCode)
                            }
                          }}
                          onBlur={() => addAccountCode(newAccountCode)}
                          placeholder="Ajouter un code..."
                          className="border-0 shadow-none focus-visible:ring-0 flex-1 min-w-[120px] font-mono text-sm h-7"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Comptes exclus</Label>
                      <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-input bg-background min-h-10">
                        {excludedCodes.map((code) => (
                          <Badge
                            key={code}
                            variant="outline"
                            className="font-mono gap-1 pr-1"
                          >
                            {code}
                            <button
                              type="button"
                              onClick={() => removeExcludedCode(code)}
                              className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                              aria-label={`Retirer ${code}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                        <Input
                          value={newExcludedCode}
                          onChange={(e) => setNewExcludedCode(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addExcludedCode(newExcludedCode)
                            }
                          }}
                          onBlur={() => addExcludedCode(newExcludedCode)}
                          placeholder="Ajouter un code..."
                          className="border-0 shadow-none focus-visible:ring-0 flex-1 min-w-[120px] font-mono text-sm h-7"
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Type de filtre</Label>
                      <Select
                        value={config.filterType || 'starts_with'}
                        onValueChange={(value) =>
                          onUpdate({ filterType: value as IncomeStatementLineConfig['filterType'] })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="starts_with">Commence par</SelectItem>
                          <SelectItem value="exact">Exact</SelectItem>
                          <SelectItem value="range">Plage</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Type de solde</Label>
                      <Select
                        value={config.balanceType}
                        onValueChange={(value) =>
                          onUpdate({ balanceType: value as IncomeStatementLineConfig['balanceType'] })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="credit">Crédit (Produits)</SelectItem>
                          <SelectItem value="debit">Débit (Charges)</SelectItem>
                          <SelectItem value="auto">Auto (Total)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                <div>
                  <Label>Ordre d'affichage</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={config.order}
                    onChange={(e) => onUpdate({ order: parseInt(e.target.value) || 0 })}
                    placeholder="1, 2, 3..."
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
