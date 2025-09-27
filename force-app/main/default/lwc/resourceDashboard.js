import { LightningElement, wire, track, api } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Apex method imports
import getCriticalResources from '@salesforce/apex/ResourceDashboardController.getCriticalResources';
import getShelterCapacity from '@salesforce/apex/ResourceDashboardController.getShelterCapacity';
import getPendingRequests from '@salesforce/apex/ResourceDashboardController.getPendingRequests';
import getDisasterSummary from '@salesforce/apex/ResourceDashboardController.getDisasterSummary';
import getResourceRecommendations from '@salesforce/apex/ResourceAllocationService.getResourceRecommendations';
import approveRequest from '@salesforce/apex/ResourceDashboardController.approveRequest';
import executeRecommendation from '@salesforce/apex/ResourceAllocationService.executeRecommendation';

const REQUEST_COLUMNS = [
    { label: 'Request #', fieldName: 'Name', type: 'text' },
    { label: 'Shelter', fieldName: 'ShelterName', type: 'text' },
    { label: 'Resource', fieldName: 'ResourceName', type: 'text' },
    { label: 'Type', fieldName: 'ResourceType', type: 'text' },
    { label: 'Quantity', fieldName: 'Quantity_Requested__c', type: 'number' },
    { label: 'Priority', fieldName: 'Priority__c', type: 'text', cellAttributes: {
        class: { fieldName: 'priorityClass' }
    }},
    { label: 'Date Requested', fieldName: 'Request_Date__c', type: 'date' },
    {
        type: 'action',
        typeAttributes: {
            rowActions: [
                { label: 'Approve', name: 'approve' },
                { label: 'View', name: 'view' },
                { label: 'Reject', name: 'reject' }
            ]
        }
    }
];

export default class ResourceDashboard extends NavigationMixin(LightningElement) {
    @api disasterId;
    
    @track criticalResources = [];
    @track shelters = [];
    @track pendingRequests = [];
    @track recommendations = [];
    @track disasterSummary = {};
    @track error;
    @track isLoading = false;
    
    requestColumns = REQUEST_COLUMNS;
    
    // Wire methods for reactive data
    @wire(getCriticalResources, { disasterId: '$disasterId' })
    wiredCriticalResources(result) {
        this.criticalResourcesResult = result;
        if (result.data) {
            this.criticalResources = result.data.map(resource => ({
                ...resource,
                isLowStock: resource.Stock_Level__c <= resource.Minimum_Threshold__c
            }));
            this.error = undefined;
        } else if (result.error) {
            this.handleError(result.error);
            this.criticalResources = [];
        }
    }
    
    @wire(getShelterCapacity, { disasterId: '$disasterId' })
    wiredShelters(result) {
        this.sheltersResult = result;
        if (result.data) {
            // Add capacity variant for progress bar coloring and additional display properties
            this.shelters = result.data.map(shelter => {
                const utilization = shelter.Capacity_Utilization__c || 0;
                let variant = 'base';
                let statusClass = 'slds-badge';
                
                if (utilization >= 90) variant = 'expired';
                else if (utilization >= 80) variant = 'warning';
                else if (utilization >= 60) variant = 'success';
                
                // Status class for operational status
                if (shelter.Operational_Status__c === 'Available') {
                    statusClass += ' slds-badge_success';
                } else if (shelter.Operational_Status__c === 'At Capacity') {
                    statusClass += ' slds-badge_error';
                } else {
                    statusClass += ' slds-badge_warning';
                }
                
                return {
                    ...shelter,
                    capacityVariant: variant,
                    statusClass: statusClass,
                    utilizationDisplay: Math.round(utilization)
                };
            });
            this.error = undefined;
        } else if (result.error) {
            this.handleError(result.error);
            this.shelters = [];
        }
    }
    
    @wire(getPendingRequests, { disasterId: '$disasterId' })
    wiredRequests(result) {
        this.requestsResult = result;
        if (result.data) {
            // Format data for datatable with correct field names
            this.pendingRequests = result.data.map(request => {
                let priorityClass = 'slds-text-color_default';
                if (request.Priority__c === 'Critical') priorityClass = 'slds-text-color_error';
                else if (request.Priority__c === 'High') priorityClass = 'slds-text-color_warning';
                
                return {
                    ...request,
                    ShelterName: request.Shelter__r?.Name || 'Unknown Shelter',
                    ResourceName: request.Resource__r?.Name || 'Unknown Resource',
                    ResourceType: request.Resource__r?.Resource_Type__c || '',
                    priorityClass: priorityClass
                };
            });
            this.error = undefined;
        } else if (result.error) {
            this.handleError(result.error);
            this.pendingRequests = [];
        }
    }
    
    @wire(getDisasterSummary, { disasterId: '$disasterId' })
    wiredDisasterSummary(result) {
        this.disasterSummaryResult = result;
        if (result.data) {
            this.disasterSummary = {
                ...result.data.disaster,
                totalShelters: result.data.shelterStats?.totalShelters || 0,
                totalCapacity: result.data.shelterStats?.totalCapacity || 0,
                totalOccupancy: result.data.shelterStats?.totalOccupancy || 0,
                avgUtilization: Math.round(result.data.shelterStats?.avgUtilization || 0),
                pendingRequests: result.data.pendingRequests || 0
            };
            this.error = undefined;
        } else if (result.error) {
            this.handleError(result.error);
        }
    }
    
    // Computed properties
    get showCriticalResources() {
        return this.criticalResources && this.criticalResources.length > 0;
    }
    
    get criticalResourcesCount() {
        return this.criticalResources ? this.criticalResources.length : 0;
    }
    
    get hasShelters() {
        return this.shelters && this.shelters.length > 0;
    }
    
    get hasPendingRequests() {
        return this.pendingRequests && this.pendingRequests.length > 0;
    }
    
    get pendingRequestsCount() {
        return this.pendingRequests ? this.pendingRequests.length : 0;
    }
    
    get hasRecommendations() {
        return this.recommendations && this.recommendations.length > 0;
    }
    
    // Event handlers
    handleRowAction(event) {
        const actionName = event.detail.action.name;
        const row = event.detail.row;
        
        switch (actionName) {
            case 'approve':
                this.approveResourceRequest(row.Id);
                break;
            case 'view':
                this.navigateToRecord(row.Id);
                break;
            case 'reject':
                this.rejectResourceRequest(row.Id);
                break;
        }
    }
    
    // Approve request method
    approveResourceRequest(requestId) {
        this.isLoading = true;
        approveRequest({ requestId: requestId })
            .then(() => {
                this.showSuccessToast('Request approved successfully');
                this.refreshData();
            })
            .catch(error => {
                this.handleError(error);
            })
            .finally(() => {
                this.isLoading = false;
            });
    }
    
    // Reject request method
    rejectResourceRequest(requestId) {
        this.isLoading = true;
        // Implement reject logic here
        this.showInfoToast('Reject functionality to be implemented');
        this.isLoading = false;
    }
    
    // Generate recommendations
    generateRecommendations() {
        if (!this.disasterId) {
            this.showErrorToast('No disaster selected');
            return;
        }
        
        this.isLoading = true;
        getResourceRecommendations({ disasterId: this.disasterId })
            .then(result => {
                this.recommendations = result.map(rec => ({
                    ...rec,
                    priorityVariant: this.getPriorityVariant(rec.priority),
                    utilizationDisplay: Math.round(rec.urgencyScore)
                }));
                this.showSuccessToast(`Generated ${result.length} recommendations`);
            })
            .catch(error => {
                this.handleError(error);
            })
            .finally(() => {
                this.isLoading = false;
            });
    }
    
    // Approve recommendation
    approveRecommendation(event) {
        const requestId = event.target.dataset.recId;
        const recommendation = this.recommendations.find(rec => rec.requestId === requestId);
        
        if (recommendation) {
            this.executeRecommendation(requestId, recommendation.recommendedQuantity);
        }
    }
    
    // Modify recommendation
    modifyRecommendation(event) {
        const requestId = event.target.dataset.recId;
        // Open modal or navigate to modification page
        this.showInfoToast('Modify recommendation functionality to be implemented');
    }
    
    // Execute recommendation
    executeRecommendation(requestId, quantity) {
        this.isLoading = true;
        executeRecommendation({ 
            recommendationId: requestId, 
            approvedQuantity: quantity,
            comments: 'Approved via dashboard'
        })
            .then(result => {
                this.showSuccessToast(result);
                this.refreshData();
                this.generateRecommendations(); // Refresh recommendations
            })
            .catch(error => {
                this.handleError(error);
            })
            .finally(() => {
                this.isLoading = false;
            });
    }
    
    // Navigation methods
    navigateToRecord(recordId) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: recordId,
                actionName: 'view'
            }
        });
    }
    
    viewAllShelters() {
        this[NavigationMixin.Navigate]({
            type: 'standard__objectPage',
            attributes: {
                objectApiName: 'Shelter__c',
                actionName: 'list'
            },
            state: {
                filterName: 'Recent'
            }
        });
    }
    
    openSettings() {
        this.showInfoToast('Settings functionality to be implemented');
    }
    
    // Utility methods
    refreshData() {
        Promise.all([
            refreshApex(this.criticalResourcesResult),
            refreshApex(this.sheltersResult),
            refreshApex(this.requestsResult),
            refreshApex(this.disasterSummaryResult)
        ]).then(() => {
            this.showSuccessToast('Data refreshed successfully');
        }).catch(error => {
            this.handleError(error);
        });
    }
    
    getPriorityVariant(priority) {
        if (priority >= 5) return 'error';
        else if (priority >= 4) return 'warning';
        else if (priority >= 3) return 'info';
        else return 'success';
    }
    
    handleError(error) {
        console.error('Dashboard Error:', error);
        this.error = error;
        
        let message = 'An unexpected error occurred';
        if (error?.body?.message) {
            message = error.body.message;
        } else if (error?.message) {
            message = error.message;
        }
        
        this.showErrorToast(message);
    }
    
    showSuccessToast(message) {
        this.dispatchEvent(
            new ShowToastEvent({
                title: 'Success',
                message: message,
                variant: 'success'
            })
        );
    }
    
    showErrorToast(message) {
        this.dispatchEvent(
            new ShowToastEvent({
                title: 'Error',
                message: message,
                variant: 'error'
            })
        );
    }
    
    showInfoToast(message) {
        this.dispatchEvent(
            new ShowToastEvent({
                title: 'Info',
                message: message,
                variant: 'info'
            })
        );
    }
}