trigger UpdateShelterCapacity on Request__c (after insert, after update, after delete) {
    
    Set<Id> shelterIds = new Set<Id>();
    
    // Collect shelter IDs from requests
    if (Trigger.isInsert || Trigger.isUpdate) {
        for (Request__c req : Trigger.new) {
            if (req.Shelter__c != null) {
                shelterIds.add(req.Shelter__c);
            }
        }
    }
    
    if (Trigger.isUpdate || Trigger.isDelete) {
        for (Request__c req : Trigger.old) {
            if (req.Shelter__c != null) {
                shelterIds.add(req.Shelter__c);
            }
        }
    }
    
    // Update shelter occupancy based on fulfilled requests
    if (!shelterIds.isEmpty()) {
        List<Shelter__c> sheltersToUpdate = new List<Shelter__c>();
        
        for (Shelter__c shelter : [SELECT Id, Current_Occupancy__c, 
                                  (SELECT Quantity_Requested__c FROM Requests__r 
                                   WHERE Request_Status__c = 'Fulfilled' 
                                   AND Resource__r.Resource_Type__c = 'Occupancy') 
                                   FROM Shelter__c WHERE Id IN :shelterIds]) {
            
            Integer totalOccupancy = 0;
            for (Request__c req : shelter.Requests__r) {
                totalOccupancy += Integer.valueOf(req.Quantity_Requested__c);
            }
            
            shelter.Current_Occupancy__c = totalOccupancy;
            sheltersToUpdate.add(shelter);
        }
        
        if (!sheltersToUpdate.isEmpty()) {
            update sheltersToUpdate;
        }
    }
}