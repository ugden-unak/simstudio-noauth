'use client'

import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KnowledgeHeader } from './components/knowledge-header/knowledge-header'
import { KnowledgeBaseCardSkeletonGrid } from './components/skeletons/knowledge-base-card-skeleton'

export default function KnowledgeLoading() {
  const breadcrumbs = [{ id: 'knowledge', label: 'Knowledge' }]

  return (
    <div className='flex h-screen flex-col pl-64'>
      {/* Header */}
      <KnowledgeHeader breadcrumbs={breadcrumbs} />

      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Main Content */}
          <div className='flex-1 overflow-auto'>
            <div className='px-6 pb-6'>
              {/* Search and Create Section */}
              <div className='mb-4 flex items-center justify-between pt-1'>
                <div className='relative max-w-md flex-1'>
                  <div className='relative flex items-center'>
                    <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] transform text-muted-foreground' />
                    <input
                      type='text'
                      placeholder='Search knowledge bases...'
                      disabled
                      className='h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                    />
                  </div>
                </div>

                <Button
                  disabled
                  size='sm'
                  className='flex items-center gap-1 bg-[#701FFC] font-[480] text-primary-foreground shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] disabled:opacity-50'
                >
                  <Plus className='h-3.5 w-3.5' />
                  <span>Create</span>
                </Button>
              </div>

              {/* Content Area */}
              <KnowledgeBaseCardSkeletonGrid count={8} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
