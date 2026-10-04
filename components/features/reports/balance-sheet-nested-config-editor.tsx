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
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ChevronRight, ChevronDown, Plus, Save, Trash2, Folder, FileText, Calculator, GripVertical, X } from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import type { BalanceSheetLineConfig } from '@/lib/reports/balance-sheet/types'

interface BalanceSheetNestedConfigEditorProps {
  configs: BalanceSheetLineConfig[]
  companyId: string
  reportVariant: 'complete' | 'simplified'
  onSave: (configs: BalanceSheetLineConfig[]) => Promise<void>
  onDelete: (configId: string) => Promise<void>
}

/**
 * Finds the root section (actif/passif) by traversing up the parent chain
 */
function findRootSection(
  config: BalanceSheetLineConfig,
  allConfigs: Map<string, BalanceSheetLineConfig>
): 'actif' | 'passif' | null {
  const label = config.lineLabel.toLowerCase()
  if (label.includes('actif') || label === 'actif') {
    return 'actif'
  }
  if (label.includes('passif') || label === 'passif') {
    return 'passif'
  }
  
  let current: BalanceSheetLineConfig | undefined = config
  while (current?.parentId) {
    const parent = allConfigs.get(current.parentId)
    if (!parent) break
    
    const parentLabel = parent.lineLabel.toLowerCase()
    if (parentLabel.includes('actif') || parentLabel === 'actif') {
      return 'actif'
    }
    if (parentLabel.includes('passif') || parentLabel === 'passif') {
      return 'passif'
    }
    
    current = parent
  }
  
  return null
}

/**
 * Flattens nested config structure to a flat array
 */
function flattenConfigs(configs: BalanceSheetLineConfig[]): BalanceSheetLineConfig[] {
  const result: BalanceSheetLineConfig[] = []
  
  function traverse(config: BalanceSheetLineConfig) {
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

export function BalanceSheetNestedConfigEditor({
  configs,
  companyId,
  reportVariant,
  onSave,
  onDelete,
}: BalanceSheetNestedConfigEditorProps) {
  const [editedConfigs, setEditedConfigs] = useState<BalanceSheetLineConfig[]>(configs)
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
    const map = new Map<string, BalanceSheetLineConfig>()
    for (const config of allConfigsFlat) {
      map.set(config.id, config)
    }
    return map
  }, [allConfigsFlat])

  // Separate actif and passif configs using explicit section field
  const { actifConfigs, passifConfigs } = useMemo(() => {
    const actif: BalanceSheetLineConfig[] = []
    const passif: BalanceSheetLineConfig[] = []
    
    for (const config of editedConfigs) {
      // Use explicit section field if available, otherwise fallback to findRootSection
      const section = config.section || findRootSection(config, configMap)
      if (section === 'actif') {
        actif.push(config)
      } else if (section === 'passif') {
        passif.push(config)
      } else {
        // Fallback: check if it's a root config and try to infer from order
        // Actif typically comes first (lower order numbers)
        if (!config.parentId) {
          // If we can't determine, check the label more broadly
          const label = config.lineLabel.toLowerCase()
          if (label.includes('actif') || label.includes('immobilis') || label.includes('circulant') || label.includes('stocks') || label.includes('créances')) {
            actif.push(config)
          } else if (label.includes('passif') || label.includes('capitaux') || label.includes('dettes') || label.includes('provisions')) {
            passif.push(config)
          } else {
            // Default: assume actif if order is low, passif if high
            // This is a fallback - ideally all configs should have section set
            if (config.order < 50) {
              actif.push(config)
            } else {
              passif.push(config)
            }
          }
        }
      }
    }
    
    // Sort by order
    actif.sort((a, b) => a.order - b.order)
    passif.sort((a, b) => a.order - b.order)
    
    return { actifConfigs: actif, passifConfigs: passif }
  }, [editedConfigs, configMap])

  const handleUpdate = (configId: string, updates: Partial<BalanceSheetLineConfig>) => {
    setEditedConfigs((prev) => {
      function updateInTree(config: BalanceSheetLineConfig): BalanceSheetLineConfig {
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

  const handleAddGroup = async (parentId?: string | null, section: 'actif' | 'passif' = 'actif') => {
    // Find parent config to get max order
    let maxOrder = 1
    if (parentId) {
      const parent = configMap.get(parentId)
      if (parent?.children) {
        maxOrder = Math.max(...parent.children.map(c => c.order), 0) + 1
      }
    } else {
      // Root level - find max order in section
      const sectionConfigs = section === 'actif' ? actifConfigs : passifConfigs
      maxOrder = Math.max(...sectionConfigs.map(c => c.order), 0) + 1
    }

    // Determine section: use parent's section if parentId exists, otherwise use provided section
    let configSection: 'actif' | 'passif' | null = null
    if (parentId) {
      const parent = configMap.get(parentId)
      configSection = parent?.section || null
    } else {
      configSection = section as 'actif' | 'passif' | null
    }

    const newConfig = {
      companyId,
      reportVariant,
      parentId: parentId || null,
      section: configSection,
      lineLabel: 'Nouveau groupe',
      lineType: 'group' as const,
      formCode: null,
      accountCodes: [],
      excludedAccountCodes: [],
      filterType: 'starts_with',
      filterValue: null,
      balanceType: 'auto' as const,
      displayType: 'net' as const,
      order: maxOrder,
      notes: null,
      templateId: null,
    }

    try {
      const response = await fetch(`/api/companies/${companyId}/balance-sheet/config/line`, {
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

  const handleAddSum = async (parentId?: string | null, section: 'actif' | 'passif' = 'actif') => {
    let maxOrder = 1
    if (parentId) {
      const parent = configMap.get(parentId)
      if (parent?.children) {
        maxOrder = Math.max(...parent.children.map(c => c.order), 0) + 1
      }
    } else {
      const sectionConfigs = section === 'actif' ? actifConfigs : passifConfigs
      maxOrder = Math.max(...sectionConfigs.map(c => c.order), 0) + 1
    }

    // Determine section: use parent's section if parentId exists, otherwise use provided section
    let configSection: 'actif' | 'passif' | null = null
    if (parentId) {
      const parent = configMap.get(parentId)
      configSection = parent?.section || null
    } else {
      configSection = section as 'actif' | 'passif' | null
    }

    const newConfig = {
      companyId,
      reportVariant,
      parentId: parentId || null,
      section: configSection,
      lineLabel: 'Nouvelle somme',
      lineType: 'sum' as const,
      formCode: null,
      accountCodes: [],
      excludedAccountCodes: [],
      filterType: 'starts_with',
      filterValue: null,
      balanceType: 'auto' as const,
      displayType: 'net' as const,
      order: maxOrder,
      notes: null,
      templateId: null,
    }

    try {
      const response = await fetch(`/api/companies/${companyId}/balance-sheet/config/line`, {
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

  const handleAddLine = async (parentId?: string | null, section: 'actif' | 'passif' = 'actif') => {
    let maxOrder = 1
    if (parentId) {
      const parent = configMap.get(parentId)
      if (parent?.children) {
        maxOrder = Math.max(...parent.children.map(c => c.order), 0) + 1
      }
    } else {
      const sectionConfigs = section === 'actif' ? actifConfigs : passifConfigs
      maxOrder = Math.max(...sectionConfigs.map(c => c.order), 0) + 1
    }

    // Determine section: use parent's section if parentId exists, otherwise use provided section
    let configSection: 'actif' | 'passif' | null = null
    if (parentId) {
      const parent = configMap.get(parentId)
      configSection = parent?.section || null
    } else {
      configSection = section as 'actif' | 'passif' | null
    }

    const newConfig = {
      companyId,
      reportVariant,
      parentId: parentId || null,
      section: configSection,
      lineLabel: 'Nouvelle ligne',
      lineType: 'line' as const,
      formCode: null,
      accountCodes: [],
      excludedAccountCodes: [],
      filterType: 'starts_with',
      filterValue: null,
      balanceType: section === 'actif' ? 'debit' as const : 'credit' as const,
      displayType: 'net' as const,
      order: maxOrder,
      notes: null,
      templateId: null,
    }

    try {
      const response = await fetch(`/api/companies/${companyId}/balance-sheet/config/line`, {
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
    configs: BalanceSheetLineConfig[],
    targetId: string,
    parentId: string | null = null
  ): { config: BalanceSheetLineConfig | null; parentId: string | null; siblings: BalanceSheetLineConfig[] } | null => {
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

    logger.debug('Drag end', { active: active.id, over: over.id, dragOverState })

    // Find both configs in the full tree
    const activeInfo = findConfigInTree(editedConfigs, active.id as string)
    const overInfo = findConfigInTree(editedConfigs, over.id as string)

    if (!activeInfo || !overInfo || !activeInfo.config || !overInfo.config) {
      logger.warn('Could not find configs in tree', { 
        active: active.id, 
        over: over.id,
        activeInfo,
        overInfo
      })
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
    // Use dragOverState if available, otherwise default to sibling (same level)
    const shouldNest = dragOverState.overId === over.id && dragOverState.isNesting
    
    let newParentId: string | null
    let targetSiblings: BalanceSheetLineConfig[]
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
        // Fallback: add at the end
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
    
    logger.debug('Moving config', {
      activeId: active.id,
      overId: over.id,
      shouldNest,
      oldParentId: activeInfo.parentId,
      newParentId,
      parentChanged,
      oldIndex,
      newIndex,
      targetSiblingsCount: targetSiblings.length
    })

    if (oldIndex === -1) {
      logger.warn('Could not find old index', { 
        oldIndex, 
        siblings: activeInfo.siblings.map(c => ({ id: c.id, order: c.order })),
        activeId: active.id
      })
      setDragOverState({ overId: null, isNesting: false })
      return
    }

    // Build a map of all configs to get full structure with children
    const prevConfigsMap = new Map<string, BalanceSheetLineConfig>()
    const buildPrevConfigMap = (configs: BalanceSheetLineConfig[]) => {
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
      // Build a map of all configs from prev to get full structure with children
      const prevConfigsMapInCallback = new Map<string, BalanceSheetLineConfig>()
      const buildPrevConfigMapInCallback = (configs: BalanceSheetLineConfig[]) => {
        configs.forEach(config => {
          prevConfigsMapInCallback.set(config.id, config)
          if (config.children) {
            buildPrevConfigMapInCallback(config.children)
          }
        })
      }
      buildPrevConfigMapInCallback(prev)

      // Get the full active config with all its children
      const activeConfigFullInCallback = prevConfigsMapInCallback.get(active.id as string) || activeInfo.config

      // Function to remove a config from the tree
      const removeFromTree = (configs: BalanceSheetLineConfig[], idToRemove: string): BalanceSheetLineConfig[] => {
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
      const addToTree = (configs: BalanceSheetLineConfig[], configToAdd: BalanceSheetLineConfig, parentId: string | null, targetIndex: number): BalanceSheetLineConfig[] => {
        if (parentId === null) {
          // Add to root level
          const newConfig = {
            ...configToAdd,
            parentId: null,
            order: targetIndex + 1,
            children: configToAdd.children || []
          }
          const result = [...configs]
          result.splice(targetIndex, 0, newConfig)
          // Update orders for all root configs
          return result.map((c, i) => ({ ...c, order: i + 1 }))
        } else {
          // Add to a specific parent's children
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
              // Update orders for all children
              const childrenWithOrder = newChildren.map((c, i) => ({ ...c, order: i + 1 }))
              return {
                ...config,
                children: childrenWithOrder
              }
            }
            // Recursively search in children
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
      // Also update orders of remaining siblings at the old parent level
      const removeFromTreeAndUpdateOrders = (configs: BalanceSheetLineConfig[], idToRemove: string, targetParentId: string | null): BalanceSheetLineConfig[] => {
        if (targetParentId === null) {
          // Remove from root level and update orders
          const filtered = configs.filter(config => config.id !== idToRemove)
          return filtered.map((c, i) => ({
            ...c,
            order: i + 1,
            children: c.children ? removeFromTreeAndUpdateOrders(c.children, idToRemove, c.id) : c.children
          }))
        } else {
          // Remove from a specific parent's children and update orders
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
            // Recursively search in children
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
        logger.warn('[Balance Sheet Config] activeConfigFullInCallback is null, cannot add to tree')
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
      // Revert on error - reload from props
      setEditedConfigs(configs)
      setDragOverState({ overId: null, isNesting: false })
    }
  }

  const updateConfigOrder = async (configId: string, newOrder: number) => {
    try {
      const response = await fetch(
        `/api/companies/${companyId}/balance-sheet/config/line/${configId}`,
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
        `/api/companies/${companyId}/balance-sheet/config/line/${configId}`,
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

  const tree: TreeActions<BalanceSheetLineConfig, 'actif' | 'passif'> = {
    expandedIds,
    toggleExpand,
    onUpdate: handleUpdate,
    onDelete,
    onAddGroup: handleAddGroup,
    onAddSum: handleAddSum,
    onAddLine: handleAddLine,
  }

  const renderConfig = (config: BalanceSheetLineConfig, section: 'actif' | 'passif') => {
    return <SortableItem key={config.id} config={config} section={section} tree={tree} />
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
          {/* ACTIF Column */}
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Actif</h2>
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddGroup(null, 'actif')}
                >
                  <Folder aria-hidden />
                  Groupe
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddSum(null, 'actif')}
                >
                  <Calculator aria-hidden />
                  Somme
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddLine(null, 'actif')}
                >
                  <FileText aria-hidden />
                  Ligne
                </Button>
              </div>
            </div>
            <SortableContext 
              items={actifConfigs.map(c => c.id)} 
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {actifConfigs.map((config) => renderConfig(config, 'actif'))}
              </div>
            </SortableContext>
          </div>

          {/* PASSIF Column */}
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Passif</h2>
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddGroup(null, 'passif')}
                >
                  <Folder aria-hidden />
                  Groupe
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddSum(null, 'passif')}
                >
                  <Calculator aria-hidden />
                  Somme
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddLine(null, 'passif')}
                >
                  <FileText aria-hidden />
                  Ligne
                </Button>
              </div>
            </div>
            <SortableContext 
              items={passifConfigs.map(c => c.id)} 
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {passifConfigs.map((config) => renderConfig(config, 'passif'))}
              </div>
            </SortableContext>
          </div>
        </div>
      </DndContext>
    </div>
  )
}

/** What a line of the tree needs from the editor. */
interface TreeActions<Config, Section> {
  expandedIds: Set<string>
  toggleExpand: (id: string) => void
  onUpdate: (configId: string, updates: Partial<Config>) => void
  onDelete: (configId: string) => Promise<void>
  onAddGroup: (parentId: string, section: Section) => void
  onAddSum: (parentId: string, section: Section) => void
  onAddLine: (parentId: string, section: Section) => void
}

/**
 * One line of the tree with its children. Declared at module level: a
 * component declared inside the editor is a new type on every render, so
 * React remounted every line on each keystroke (the input lost its focus
 * and the settings panel closed).
 */
function SortableItem({
  config,
  section,
  tree,
}: {
  config: BalanceSheetLineConfig
  section: 'actif' | 'passif'
  tree: TreeActions<BalanceSheetLineConfig, 'actif' | 'passif'>
}) {
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

  const isExpanded = tree.expandedIds.has(config.id)
  const hasChildren = config.children && config.children.length > 0
  const isGroup = config.lineType === 'group'
  const isSum = config.lineType === 'sum'

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
              onClick={() => tree.toggleExpand(config.id)}
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
          <BalanceSheetLineConfigEditor
            config={config}
            onUpdate={(updates) => tree.onUpdate(config.id, updates)}
            onDelete={() => tree.onDelete(config.id)}
            onAddGroup={() => tree.onAddGroup(config.id, section)}
            onAddSum={() => tree.onAddSum(config.id, section)}
            onAddLine={() => tree.onAddLine(config.id, section)}
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
              <SortableItem key={child.id} config={child} section={section} tree={tree} />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  )
}

interface BalanceSheetLineConfigEditorProps {
  config: BalanceSheetLineConfig
  onUpdate: (updates: Partial<BalanceSheetLineConfig>) => void
  onDelete: () => void
  onAddGroup: () => void
  onAddSum: () => void
  onAddLine: () => void
  isGroup: boolean
  isSum: boolean
  section: 'actif' | 'passif'
}

function BalanceSheetLineConfigEditor({
  config,
  onUpdate,
  onDelete,
  onAddGroup,
  onAddSum,
  onAddLine,
  isGroup,
  isSum,
  section,
}: BalanceSheetLineConfigEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [newAccountCode, setNewAccountCode] = useState('')
  const [newExcludedCode, setNewExcludedCode] = useState('')
  const [newAmortissementCode, setNewAmortissementCode] = useState('')

  const accountCodes = config.accountCodes ?? []
  const excludedCodes = config.excludedAccountCodes ?? []
  const amortissementCodes = config.amortissementAccountCodes ?? []

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

  const addAmortissementCode = (code: string) => {
    const trimmed = code.trim()
    if (trimmed && !amortissementCodes.includes(trimmed)) {
      onUpdate({ amortissementAccountCodes: [...amortissementCodes, trimmed] })
      setNewAmortissementCode('')
    }
  }

  const removeAmortissementCode = (code: string) => {
    onUpdate({ amortissementAccountCodes: amortissementCodes.filter((c) => c !== code) })
  }

  const getTypeLabel = () => {
    if (isGroup) return 'Groupe'
    if (isSum) return 'Somme'
    return 'Ligne'
  }

  const isActif = section === 'actif'

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

                <div>
                  <Label>Type</Label>
                  <Select
                    value={config.lineType}
                    onValueChange={(value) => onUpdate({ lineType: value as 'group' | 'sum' | 'line' })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="group">Groupe (organisation uniquement)</SelectItem>
                      <SelectItem value="sum">Somme (somme des enfants)</SelectItem>
                      <SelectItem value="line">Ligne (avec comptes)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {!config.parentId && (
                  <div>
                    <Label>Section</Label>
                    <Select
                      value={config.section || 'none'}
                      onValueChange={(value) => onUpdate({ section: value === 'none' ? null : value as 'actif' | 'passif' })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner une section" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="actif">Actif</SelectItem>
                        <SelectItem value="passif">Passif</SelectItem>
                        <SelectItem value="none">Aucune (héritée du parent)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Section du bilan (uniquement pour les lignes racines)
                    </p>
                  </div>
                )}

                <div>
                  <Label>Code formulaire (Brut)</Label>
                  <Input
                    value={config.formCode || ''}
                    onChange={(e) => onUpdate({ formCode: e.target.value || null })}
                    placeholder="AA, AB, AF..."
                  />
                </div>

                {isActif && config.displayType === 'brut_amort_net' && (
                  <div>
                    <Label>Code formulaire (Amortissements)</Label>
                    <Input
                      value={config.amortissementFormCode || ''}
                      onChange={(e) => onUpdate({ amortissementFormCode: e.target.value || null })}
                      placeholder="AC, CQ, AG..."
                    />
                  </div>
                )}

                {(isSum || config.lineType === 'line') && (
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

                    {isActif && (
                      <div className="space-y-2">
                        <Label>Comptes d'amortissement</Label>
                        <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-input bg-background min-h-10">
                          {amortissementCodes.map((code) => (
                            <Badge
                              key={code}
                              variant="outline"
                              className="font-mono gap-1 pr-1"
                            >
                              {code}
                              <button
                                type="button"
                                onClick={() => removeAmortissementCode(code)}
                                className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                                aria-label={`Retirer ${code}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                          <Input
                            value={newAmortissementCode}
                            onChange={(e) => setNewAmortissementCode(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                addAmortissementCode(newAmortissementCode)
                              }
                            }}
                            onBlur={() => addAmortissementCode(newAmortissementCode)}
                            placeholder="2801, 2901..."
                            className="border-0 shadow-none focus-visible:ring-0 flex-1 min-w-[120px] font-mono text-sm h-7"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Comptes pour la colonne Amortissement (28xx, 29xx, 39xx)
                        </p>
                      </div>
                    )}

                    <div>
                      <Label>Type de filtre</Label>
                      <Select
                        value={config.filterType || 'starts_with'}
                        onValueChange={(value) =>
                          onUpdate({ filterType: value as BalanceSheetLineConfig['filterType'] })
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
                          onUpdate({ balanceType: value as BalanceSheetLineConfig['balanceType'] })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="debit">Débit (Actif)</SelectItem>
                          <SelectItem value="credit">Crédit (Passif)</SelectItem>
                          <SelectItem value="auto">Auto (Total)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {isActif && (
                      <div>
                        <Label>Type d'affichage</Label>
                        <Select
                          value={config.displayType || 'net'}
                          onValueChange={(value) =>
                            onUpdate({ displayType: value as 'net' | 'brut_amort_net' })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="net">Net uniquement</SelectItem>
                            <SelectItem value="brut_amort_net">Brut / Amortissement / Net</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`hideLabel-${config.id}`}
                        checked={config.hideLabel || false}
                        onCheckedChange={(checked) => onUpdate({ hideLabel: checked === true })}
                      />
                      <Label htmlFor={`hideLabel-${config.id}`} className="cursor-pointer">
                        Masquer le titre
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Si activé, le titre de cette ligne ne sera pas affiché dans les rapports
                    </p>
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
