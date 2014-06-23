######################################################################
#
# Copyright (C) Zenoss, Inc. 2014, all rights reserved.
#
# This content is made available according to terms specified in
# License.zenoss under the directory where your Zenoss product is
# installed.
#
######################################################################

from logging import getLogger
log = getLogger('zen.Layer2Plugins')

import re

from twisted.internet import defer

from Products.DataCollector.SnmpClient import SnmpClient
from Products.DataCollector.plugins.CollectorPlugin import SnmpPlugin, GetTableMap
from Products.DataCollector.plugins.DataMaps import ObjectMap
from Products.ZenEvents import ZenEventClasses
from Products.ZenUtils.Utils import prepId
from Products.ZenUtils.Driver import drive

from ZenPacks.zenoss.PythonCollector.datasources.PythonDataSource \
    import PythonDataSourcePlugin

from .utils import asmac

PLUGIN_NAME = "Layer2Info"

class Layer2Options(object):
    """
    Minimal options to run SnmpPlugin
    """
    force = True
    discoverCommunity = False


class Layer2SnmpPlugin(SnmpPlugin):
    """
    Snmp plugin to collect MAC forwarding tables and ports
    """

    snmpGetTableMaps = (
        # Layer2: physical ports to MACs of clients
        GetTableMap('dot1dTpFdbTable', '.1.3.6.1.2.1.17.4.3.1',
                {'.1': 'dot1dTpFdbAddress',
                 '.2': 'dot1dTpFdbPort',
                 '.3': 'dot1dTpFdbStatus'}
        ),
        # Ports to Interfaces
        GetTableMap('dot1dBasePortEntry', '1.3.6.1.2.1.17.1.4.1',
                {'.1': 'dot1dBasePort',
                 '.2': 'dot1dBasePortIfIndex'}
        )
    )

    def name(self):
        return PLUGIN_NAME


class Layer2InfoPlugin(PythonDataSourcePlugin):
    """
    Datasource plugin for Device to collect MAC forwarding tables
    """

    proxy_attributes = (
        'zSnmpCommunity',
        'zSnmpVer',
        'zSnmpPort',
        'zSnmpTimeout',
        'zSnmpTries',
        'zSnmpSecurityName',
        'zSnmpAuthType',
        'zSnmpPrivType',
        'zSnmpPrivPassword',
        'zSnmpEngineId',
        'get_ifinfo_for_layer2'
    )

    component = None

    def get_snmp_client(self, vlan, config, ds0):
        ds0.zSnmpCommunity = self.community + "@" + vlan
        sc = SnmpClient(
            hostname=config.id,
            ipaddr=config.manageIp,
            options=Layer2Options(),
            device=ds0,
            datacollector=self,
            plugins=[Layer2SnmpPlugin(),]
        )
        sc.initSnmpProxy()
        return sc

    @defer.inlineCallbacks
    def collect(self, config):
        """
        Iterates over device's Ip Interfaces and gathers Layer 2 information
        with SNMP
        """
        results = self.new_data()
        ds0 = config.datasources[0]
        ds0.id = config.id

        self.iftable = ds0.get_ifinfo_for_layer2
        self.jobs = []

        self.community = ds0.zSnmpCommunity

        for vlan in self.get_vlans(): # ["1", "951"]:
            sc = self.get_snmp_client(vlan, config, ds0)
            yield drive(sc.doRun)
            res = sc._tabledata.get(PLUGIN_NAME, {})
            self._prep_iftable(res)
                
        results['maps'] = list(self.get_maps())

        defer.returnValue(results)

    def get_vlans(self):
        '''
        Yields serie of strings - vlans ids,
        extracted from keys in self.iftable
        '''
        for ifid in self.iftable:
            if 'vlan' in ifid.lower():
                yield ifid.lower().replace('vlan', '')

    def _prep_iftable(self, res):
        """
        Extracts MAC addresses and switch ports from Snmp data
        """
        tabledata = {}
        for tmap, data in res.items():
            tabledata[tmap.name] = tmap.mapdata(data)

        dot1dTpFdbTable = tabledata.get("dot1dTpFdbTable", {})
        dot1dBasePortEntry = tabledata.get("dot1dBasePortEntry", {})

        for ifid, data in self.iftable.items():
            ifindex = data["ifindex"]

            for port, row in dot1dBasePortEntry.items():
                if int(ifindex) == row['dot1dBasePortIfIndex']:
                    data['baseport'] = row['dot1dBasePort']

                    for idx, item in dot1dTpFdbTable.items():
                        if (item['dot1dTpFdbStatus'] == 3) \
                        and (row['dot1dBasePort'] == item['dot1dTpFdbPort']):
                            data['clientmacs'].append(
                                asmac(item['dot1dTpFdbAddress'])
                            )

    def get_maps(self):
        """
        Create Object/Relationship map for component remodeling.

        @param datasource: device datasourse
        @type datasource: instance of PythonDataSourceConfig
        @yield: ObjectMap|RelationshipMap
        """
        for ifid, data in self.iftable.items():
            yield ObjectMap({
                "compname": "os/interfaces/%s" % ifid,
                "modname": "Layer2: clients MACs added",
                "clientmacs": data["clientmacs"],
                "baseport": data["baseport"]
            })
        yield ObjectMap({
            "set_reindex_maps": True,
        })

    def onSuccess(self, result, config):
        """
        This method return a data structure with zero or more events, values
        and maps.  result - is what returned from collect.
        """
        for component in result['values'].keys():
            result['events'].append({
                'component': component,
                'summary': 'Layer2 Info ok',
                'eventKey': 'layer2_monitoring_error',
                'eventClass': '/Status',
                'severity': ZenEventClasses.Clear,
            })
        return result

    def onError(self, result, config):
        data = self.new_data()
        data['events'].append({
            'component': self.component,
            'summary': str(result),
            'eventKey': 'layer2_monitoring_error',
            'eventClass': '/Status',
            'severity': ZenEventClasses.Error,
        })
        return data
