'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingAgent } from '@/components/ui/loading-agent';
import { createLogger } from '@/lib/logs/console-logger';

const logger = createLogger('WorkspacePage');

export default function WorkspacePage() {
  const router = useRouter();

  useEffect(() => {
    const redirectToFirstWorkspace = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const redirectWorkflowId = urlParams.get('redirect_workflow');

        if (redirectWorkflowId) {
          try {
            const workflowResponse = await fetch(`/api/workflows/${redirectWorkflowId}`);
            if (workflowResponse.ok) {
              const workflowData = await workflowResponse.json();
              const workspaceId = workflowData.data?.workspaceId;
              if (workspaceId) {
                logger.info(
                  `Redirecting workflow ${redirectWorkflowId} to workspace ${workspaceId}`,
                );
                router.replace(`/workspace/${workspaceId}/w/${redirectWorkflowId}`);
                return;
              }
            }
          } catch (error) {
            logger.error('Error fetching workflow for redirect:', error);
          }
        }

        const response = await fetch('/api/workspaces');
        if (!response.ok) throw new Error('Failed to fetch workspaces');
        const data = await response.json();
        const workspaces = data.workspaces || [];

        if (workspaces.length === 0) {
          logger.warn('No workspaces found, creating default workspace');
          try {
            const createResponse = await fetch('/api/workspaces', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: 'My Workspace' }),
            });
            if (createResponse.ok) {
              const createData = await createResponse.json();
              const newWorkspace = createData.workspace;
              if (newWorkspace?.id) {
                logger.info(`Created default workspace: ${newWorkspace.id}`);
                router.replace(`/workspace/${newWorkspace.id}/w`);
                return;
              }
            }
          } catch (createError) {
            logger.error('Error creating default workspace:', createError);
          }
        } else {
          const firstWorkspace = workspaces[0];
          logger.info(`Redirecting to first workspace: ${firstWorkspace.id}`);
          router.replace(`/workspace/${firstWorkspace.id}/w`);
          return;
        }
      } catch (error) {
        logger.error('Error fetching workspaces for redirect:', error);
      }
    };

    if (
      typeof window !== 'undefined' &&
      window.location.pathname === '/workspace'
    ) {
      redirectToFirstWorkspace();
    }
  }, [router]);

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="flex flex-col items-center justify-center text-center align-middle">
        <LoadingAgent size="lg" />
      </div>
    </div>
  );
}

