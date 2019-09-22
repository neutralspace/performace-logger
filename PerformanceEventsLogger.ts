/** @constant
 @type {string}
 */
export const PERFORMANCE_LOG_NAME = 'performance';

/**
 * Interface that represent a list of page loading stages
 * @interface
 */
interface LoadTimingType {
  [key: string]: number;
}

/**
 * Interface that represent a loaded resource entry
 * @interface
 */
interface ResourceType {
  type: string;
  time: number;
  url: string;
  dns: number;
  stalled: number;
  ttfb: number;
  download: number;
  raw?: object;
}

/**
 * Type that represent a list of loaded resources entries
 * @type object[]
 */
type ResourceListType = object[];

/**
 * Enum for performance event types.
 * @readonly
 * @enum {number}
 */
enum EVENT_TYPES {
  PAGE_LOAD_TIME = 0,
  RESOURCES_TIME = 1,
}

/**
 * Class to make logs of performance statistics records
 * from browser`s PerformanceObserver API.
 */
export default class PerformanceEventsLogger {
  pageLoadTiming: LoadTimingType;
  resourcesListTiming: ResourceListType = [];
  private resourcesQueue: ResourceListType = [];
  private logIndex: number = 1;
  private readonly performanceLog;
  private readonly MAX_LOADING_TIME: number = 1000;
  private readonly MAX_QUEUE_EVENTS: number = 20;
  private readonly LOGGER_DURATION_LIMIT: number = 300 * 1000;

  /**
   * Create a performance log instance in base logger.
   */
  constructor() {
    if (this.isLogsAllowed()) {
      this.performanceLog = [];
      this.init();
    }
  }

  /**
   * Get page load statistics and loaded resources list on page load.
   * Subscribe to updates of page resources.
   */
  init(): void {
    window.addEventListener('load', () => {
      this.getTimingList();
      this.getResourcesList();
      this.subscribeToNewResources();
    });
  }

  isLogsAllowed(): boolean {
    return 'PerformanceObserver' in window;
  }

  /**
   * Count whether or not logger instance should log resources.
   * @param {number} percent - Probability.
   * @returns {boolean} - Indicates whether logger should be initiated.
   */
  private isSelectedToLog(percent: number): boolean {
    const count = Math.trunc(Math.random() * 100);
    return count <= percent;
  }

  /**
   *  Add event to the performance log instance.
   *  @param {number} type - Event`s type from EVENTS_TYPE enum.
   *  @param {object} [body={}] body - Event`s data.
   */
  private logEvent(type: number, body: object = {}): void {
    const event: { [key: string]: any } = { body };

    if (type === EVENT_TYPES['PAGE_LOAD_TIME']) {
      event.type = 'pageLoadTiming';
      event.title = 'Page loading time';
      event.tags = ['Page loading time'];
    } else {
      event.type = 'resourcesListTiming';
      event.title = 'Loaded resources list';
      event.tags = ['Loaded resources list'];
    }

    // Log hanlder should be here
    this.performanceLog.push(event);
  }

  private createLogEntry(title: string, content: string): string {
    return `${this.logIndex++}. ${title}: ${content}}`;
  }

  /**
   *  Get timing data of page loading and logs it as a performance log event.
   */
  private getTimingList(): void {
    const navigationTiming: any = performance.getEntriesByType('navigation')[0];
    const {
      responseEnd: loadTime,
      domContentLoadedEventEnd: domContentTime,
      domComplete: interactiveTime,
      responseStart,
      responseEnd,
      requestStart,
      transferSize = false,
    } = navigationTiming;
    const render = performance.getEntriesByType('paint')[1];
    const renderTime = render ? render.startTime : 0;
    const ttfb = Math.trunc(responseStart - requestStart);
    let { name: url } = navigationTiming;
    let loadSpeed = null;

    if (transferSize) {
      loadSpeed = this.getLoadSpeed((responseEnd - responseStart), transferSize);
    }
    if (url === 'document') {
      url = document.location.href;
    }

    this.pageLoadTiming = {
      url,
      ttfb,
      loadSpeed,
      load: Math.trunc(loadTime),
      domContent: Math.trunc(domContentTime),
      render: Math.trunc(renderTime),
      interactive: Math.trunc(interactiveTime),
    };

    if (this.pageLoadTiming.load > 0) {
      this.logEvent(EVENT_TYPES['PAGE_LOAD_TIME'], this.pageLoadTiming);
    }
  }

  /**
   * Get all page resources by current moment,
   * is used to get initial resources list on page load event.
   */
  private getResourcesList(): void {
    const resources = performance.getEntriesByType('resource');
    const resourcesEntries: ResourceListType = this.parseResources(resources);

    if (resourcesEntries.length) {
      this.resourcesListTiming = [...resourcesEntries];
      this.logEvent(EVENT_TYPES['RESOURCES_TIME'], this.resourcesListTiming);
    }
  }

  /**
   * Update instance`s list of resources with a given list of new entries.
   * @param {object[]} newResources - Array of new entries of loaded resources.
   */
  private updateResourcesList(newResources: object[]): void {
    const resourcesEntries: ResourceListType = this.parseResources(newResources);

    this.resourcesQueue.push(...resourcesEntries);

    if (this.resourcesQueue.length >= this.MAX_QUEUE_EVENTS) {
      const resourcesQueue = [...this.resourcesQueue];
      this.logEvent(EVENT_TYPES['RESOURCES_TIME'], resourcesQueue);

      this.resourcesListTiming.push(...resourcesQueue);
      this.resourcesQueue = [];
    }
  }

  /** Make array of formatted entries with required
   * fields only.
   * @param {object[]} resourcesEntries - Array of resources entries to map over.
   * @returns {object[]} List of parsed resources.
   */
  private parseResources(resourcesEntries: object[]): ResourceListType {
    const parsedResources: ResourceListType = [];

    resourcesEntries.map((resourceEntry) => {
      if (!this.isResourceCached(resourceEntry)) {
        const resourceData = this.getResourceData(resourceEntry);
        parsedResources.push({ ...resourceData });
      }
    });
    return parsedResources;
  }

  /**
   * Get required formatted data from single resource entry.
   * @param {Object.<string, any>} resourceEntry - Resource entry to parse.
   * @returns {ResourceType} The formatted resource entry.
   */
  private getResourceData(resourceEntry: { [key: string]: any }): ResourceType {
    const {
      startTime,
      domainLookupStart,
      domainLookupEnd,
      requestStart,
      responseStart,
      responseEnd,
    } = resourceEntry;
    const { initiatorType: type, duration, name: url } = resourceEntry;
    const time = Math.trunc(duration);
    const details: any = {};

    details.dns = Math.trunc(domainLookupEnd - domainLookupStart);
    details.stalled = Math.trunc(requestStart > 0 ? requestStart - startTime : 0);
    details.ttfb = Math.trunc(responseStart - requestStart);
    details.download = Math.trunc(responseEnd - (responseStart || startTime));
    details.slow = time > this.MAX_LOADING_TIME;

    return { type, time, url, ...details };
  }

  /**
   *  Subscribe to any updates in the page resources list,
   *  trigger every time an updateResourcesList() method.
   *  For old browsers all unlogged entries will be
   *  uploaded on unbeforeunload window event.
   */
  private subscribeToNewResources(): void {
    const getLastResources = () => {
      const newResources = this.getResourcesDiff();
      if (newResources.length > 0) {
        this.addNewResources(newResources);
      }
    };

    if (PerformanceObserver !== undefined) {
      const resourcesObserver = new PerformanceObserver((list) => {
        this.updateResourcesList(list.getEntries());
      });

      resourcesObserver.observe({ entryTypes: ['resource'] });
      setTimeout(() => {
        resourcesObserver.disconnect();
        window.removeEventListener('beforeunload', getLastResources);
      }, this.LOGGER_DURATION_LIMIT);
    }

    /**
     *  Updates resources list last time before page unload.
     */
    window.addEventListener('beforeunload', getLastResources);
  }

  /**
   *  Add new loaded resources to the inner list and
   *  log them to the performance logger.
   *  @param {object[]} resourcesToAdd - Array of new resources.
   */
  private addNewResources(resourcesToAdd: object[]): void {
    const newResources = this.parseResources(resourcesToAdd);

    if (newResources.length) {
      this.logEvent(EVENT_TYPES['RESOURCES_TIME'], newResources);
      this.resourcesListTiming.push(...newResources);
    }
  }

  /**
   * Get the difference between list of already logged resources and a list of
   * all loaded resources by current page.
   * @returns {object[]} Array of unlogged resources.
   */
  private getResourcesDiff(): object[] {
    const resourcesListSize = this.resourcesListTiming.length;
    const currentResourcesList = performance.getEntriesByType('resource');
    const newResources = [];

    if (currentResourcesList.length > resourcesListSize) {
      const resourcesDiff = currentResourcesList.length - resourcesListSize;
      newResources.push(...currentResourcesList.slice(-resourcesDiff));
    }
    return newResources;
  }

  /**
   * Get load speed of current page.
   * @param {number} time - Time in ms.
   * @param {number} size - Transfer size of response.
   * @retuns {number} - Speed of response loading in kB/ms.
   */
  getLoadSpeed(time: number, size: number): number | null {
    if (!time || !size) {
      return null;
    }
    const speed = Math.trunc((size / (time * 0.001)) / 1024);
    return speed;
  }

  /**
   * Check if resource is loaded from cache or from some url.
   * @param {Object.<string, any>} resource - Resource entry to check.
   * @returns {boolean} - Whether or not a resource is cached.
   */
  isResourceCached(resource: { [key: string]: any }): boolean {
    if (resource.transferSize > 0) {
      return false;
    }
    if (resource.decodedBodySize > 0) {
      return true;
    }
    return !(resource.duration > 0);
  }

}
