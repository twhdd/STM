import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../../context/useAuth";
import {
  REALTIME_EVENTS,
  subscribeToRealtimeEvents,
} from "../../services/realtime";
import { getJobs, getJobStatus } from "../../services/trafficVisionService";
import VideoUploadCard from "./VideoUploadCard";
import JobStatusCard from "./JobStatusCard";
import AnalysisResultsView from "./AnalysisResultsView";
import AnnotatedVideoPlayer from "./AnnotatedVideoPlayer";
import JobHistoryList from "./JobHistoryList";

export function TrafficVisionView() {
  const { token } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [activeJob, setActiveJob] = useState(null);
  const [refreshingActive, setRefreshingActive] = useState(false);
  const pollingRef = useRef(null);

  const activeJobId = activeJob?.id || activeJob?._id;

  // 1. Fetch recent jobs on initial mount
  useEffect(() => {
    let isCancelled = false;

    async function fetchInitialJobs() {
      try {
        const res = await getJobs(20);
        if (!isCancelled && res?.jobs) {
          setJobs(res.jobs);
          setActiveJob((prev) => prev || (res.jobs.length > 0 ? res.jobs[0] : null));
        }
      } catch (err) {
        console.error("Failed to load CV jobs:", err);
      } finally {
        if (!isCancelled) {
          setLoadingJobs(false);
        }
      }
    }

    fetchInitialJobs();

    return () => {
      isCancelled = true;
    };
  }, []);

  // 2. Refresh active job explicitly
  const refreshActiveJob = useCallback(async () => {
    if (!activeJobId) return;
    try {
      setRefreshingActive(true);
      const res = await getJobStatus(activeJobId);
      if (res?.job) {
        setActiveJob(res.job);
        setJobs((prev) =>
          prev.map((j) => ((j.id || j._id) === activeJobId ? res.job : j))
        );
      }
    } catch (err) {
      console.error("Failed to refresh active job:", err);
    } finally {
      setRefreshingActive(false);
    }
  }, [activeJobId]);

  // 3. Realtime Socket.IO subscription
  useEffect(() => {
    if (!token) return undefined;

    const handleRealtimeStatus = (payload) => {
      if (!payload?.jobId) return;

      const updatedJobId = String(payload.jobId);

      // Update in active job if matching
      setActiveJob((current) => {
        if (!current) return current;
        const currentId = String(current.id || current._id);
        if (currentId === updatedJobId) {
          return {
            ...current,
            status: payload.status,
            completedAt: payload.completedAt,
            processingDurationMs: payload.processingDurationMs,
            metrics: payload.metrics || current.metrics,
            error: payload.error || current.error,
          };
        }
        return current;
      });

      // Update in recent jobs list
      setJobs((prev) =>
        prev.map((j) => {
          const jId = String(j.id || j._id);
          if (jId === updatedJobId) {
            return {
              ...j,
              status: payload.status,
              completedAt: payload.completedAt,
              processingDurationMs: payload.processingDurationMs,
              metrics: payload.metrics || j.metrics,
              error: payload.error || j.error,
            };
          }
          return j;
        })
      );
    };

    const unsubscribe = subscribeToRealtimeEvents(
      token,
      [REALTIME_EVENTS.TRAFFIC_VISION_STATUS],
      handleRealtimeStatus
    );

    return () => {
      unsubscribe();
    };
  }, [token]);

  // 4. Polling fallback when active job is QUEUED or PROCESSING
  useEffect(() => {
    const isWorking =
      activeJob?.status === "QUEUED" || activeJob?.status === "PROCESSING";

    if (isWorking && activeJobId) {
      if (pollingRef.current) clearInterval(pollingRef.current);

      pollingRef.current = setInterval(async () => {
        try {
          const res = await getJobStatus(activeJobId);
          if (res?.job) {
            setActiveJob(res.job);
            setJobs((prev) =>
              prev.map((j) => ((j.id || j._id) === activeJobId ? res.job : j))
            );
            if (res.job.status === "COMPLETED" || res.job.status === "FAILED") {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 3000);
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeJob?.status, activeJobId]);

  // 5. Handler when new job is submitted
  const handleJobCreated = (newJob) => {
    setActiveJob(newJob);
    setJobs((prev) => [newJob, ...prev]);
  };

  return (
    <div className="cv-container">
      {/* Upload Section */}
      <VideoUploadCard onJobCreated={handleJobCreated} />

      {/* Active Job Status */}
      {activeJob && (
        <JobStatusCard
          job={activeJob}
          onRefresh={refreshActiveJob}
          refreshing={refreshingActive}
        />
      )}

      {/* Analysis Results Metrics */}
      {activeJob?.status === "COMPLETED" && (
        <>
          <AnalysisResultsView job={activeJob} />
          <AnnotatedVideoPlayer job={activeJob} />
        </>
      )}

      {/* Recent Analysis Job History */}
      <JobHistoryList
        jobs={jobs}
        activeJobId={activeJobId}
        onSelectJob={(j) => setActiveJob(j)}
        loading={loadingJobs}
      />
    </div>
  );
}

export default TrafficVisionView;
