import { SING_BOX_CONFIG, generateRuleSets, generateRules, getOutbounds, PREDEFINED_RULE_SETS, getOutboundDirectionType } from './config.js';
import { BaseConfigBuilder } from './BaseConfigBuilder.js';
import { DeepCopy, parseCountryFromNodeName } from './utils.js';
import { t } from './i18n/index.js';

export class SingboxConfigBuilder extends BaseConfigBuilder {
    constructor(inputString, selectedRules, customRules, baseConfig, lang, userAgent, groupByCountry = false, proxyType = 0) {
        if (baseConfig === undefined) {
            baseConfig = SING_BOX_CONFIG;
            if (baseConfig.dns && baseConfig.dns.servers) {
                baseConfig.dns.servers[0].detour = t('outboundNames.Node Select');
            }
        }
        super(inputString, baseConfig, lang, userAgent, groupByCountry, proxyType);
        // don't support load balancing in singbox
        // set it to 1: select automatically if proxyType is 2
        if (this.proxyType === 2) {
            this.proxyType = 1
        }
        this.selectedRules = selectedRules;
        this.customRules = customRules;
        this.countryGroupNames = [];
        this.manualGroupName = null;
    }

    getProxies() {
        return this.config.outbounds.filter(outbound => outbound?.server != undefined);
    }

    getProxyName(proxy) {
        return proxy.tag;
    }

    convertProxy(proxy) {
        return proxy;
    }

    addProxyToConfig(proxy) {
        // Check if there are proxies with similar tags in existing outbounds
        const similarProxies = this.config.outbounds.filter(p => p.tag && p.tag.includes(proxy.tag));

        // Check if there is a proxy with identical data (excluding the tag)
        const isIdentical = similarProxies.some(p => {
            const { tag: _, ...restOfProxy } = proxy; // Exclude the tag attribute
            const { tag: __, ...restOfP } = p;       // Exclude the tag attribute
            return JSON.stringify(restOfProxy) === JSON.stringify(restOfP);
        });

        if (isIdentical) {
            // If there is a proxy with identical data, skip adding it
            return;
        }

        // If there are proxies with similar tags but different data, modify the tag name
        if (similarProxies.length > 0) {
            proxy.tag = `${proxy.tag} ${similarProxies.length + 1}`;
        }

        this.config.outbounds.push(proxy);
    }

    addAutoSelectGroup(proxyList) {
        this.config.outbounds.unshift({
            type: "urltest",
            tag: t('outboundNames.Auto Select'),
            outbounds: DeepCopy(proxyList),
        });
    }

    addNodeSelectGroup(proxyList) {
        proxyList.unshift('DIRECT', 'REJECT', t('outboundNames.Auto Select'));
        this.config.outbounds.unshift({
            type: "selector",
            tag: t('outboundNames.Node Select'),
            outbounds: proxyList
        });
    }

    // no load balance support in singbox
    addBalanceSelectGroup(proxyList) {

    }

    // buildSelectorMembers(proxyList = []) {
    //     const normalize = (s) => typeof s === 'string' ? s.trim() : s;
    //     const base = this.groupByCountry
    //         ? [
    //             t('outboundNames.Node Select'),
    //             t('outboundNames.Auto Select'),
    //             ...(this.manualGroupName ? [this.manualGroupName] : []),
    //             ...(this.countryGroupNames || [])
    //         ]
    //         : [
    //             t('outboundNames.Node Select'),
    //             ...proxyList
    //         ];
    //     const combined = ['DIRECT', 'REJECT', ...base].filter(Boolean);
    //     const seen = new Set();
    //     return combined.filter(name => {
    //         const key = normalize(name);
    //         if (!key || seen.has(key)) return false;
    //         seen.add(key);
    //         return true;
    //     });
    // }

    // PATCH: won't add unnecessary selector
    // type: -1: reject/block, 0: direct, 1: proxy
    buildSelectorMember(directionType = 1) {
        const select = t('outboundNames.Node Select');
        const autoSelect = t('outboundNames.Auto Select');
        const loadBalance = t('outboundNames.Load Balance');
        const direct = 'DIRECT';
        const reject = 'REJECT';
        let proxy = select;
        switch (directionType) {
            case -1: proxy = reject; break;
            case 0: proxy = direct; break;
            case 1: {
                // proxyType: 0, select manually; 1, select automatically; 2, load balancing
                if (this.proxyType === 0) proxy = select;  // select manually
                else if (this.proxyType === 1) proxy = autoSelect; //select automatically
                else if (this.proxyType === 2) proxy = loadBalance; //this.proxyType 
                break;
            };
            default: proxy = select; break;
        };
        return proxy;
    }

    addOutboundGroups(outbounds, proxyList) {
        outbounds.forEach(outbound => {
            if (outbound !== t('outboundNames.Node Select')) {
                // const selectorMembers = this.buildSelectorMembers(proxyList);
                const directionType = getOutboundDirectionType(outbound);
                const selectorMembers = Array.from([this.buildSelectorMember(directionType)]);
                this.config.outbounds.push({
                    type: "selector",
                    tag: t(`outboundNames.${outbound}`),
                    outbounds: selectorMembers
                });
            }
        });
    }

    addCustomRuleGroups(proxyList) {
        if (Array.isArray(this.customRules)) {
            this.customRules.forEach(rule => {
                // const selectorMembers = this.buildSelectorMembers(proxyList);
                const directionType = getOutboundDirectionType(outbound);
                const selectorMembers = Array.from([this.buildSelectorMember(directionType)]);
                this.config.outbounds.push({
                    type: "selector",
                    tag: rule.name,
                    outbounds: selectorMembers
                });
            });
        }
    }

    addFallBackGroup(proxyList) {
        // const selectorMembers = this.buildSelectorMembers(proxyList);
        const directionType = getOutboundDirectionType('Fall Back');
        const selectorMembers = Array.from([this.buildSelectorMember(directionType)]);
        this.config.outbounds.push({
            type: "selector",
            tag: t('outboundNames.Fall Back'),
            outbounds: selectorMembers
        });
    }

    addCountryGroups() {
        const proxies = this.getProxies();
        const countryGroups = {};

        proxies.forEach(proxy => {
            const countryInfo = parseCountryFromNodeName(proxy?.tag || '');
            if (countryInfo) {
                const { name } = countryInfo;
                if (!countryGroups[name]) {
                    countryGroups[name] = { ...countryInfo, proxies: [] };
                }
                countryGroups[name].proxies.push(proxy.tag);
            }
        });

        const normalize = (s) => typeof s === 'string' ? s.trim() : s;
        const existingTags = new Set((this.config.outbounds || []).map(o => normalize(o?.tag)).filter(Boolean));

        const manualProxyNames = proxies.map(p => p?.tag).filter(Boolean);
        const manualGroupName = manualProxyNames.length > 0 ? t('outboundNames.Manual Switch') : null;
        if (manualGroupName) {
            const manualNorm = normalize(manualGroupName);
            if (!existingTags.has(manualNorm)) {
                this.config.outbounds.push({
                    type: 'selector',
                    tag: manualGroupName,
                    outbounds: manualProxyNames
                });
                existingTags.add(manualNorm);
            }
        }

        const countries = Object.keys(countryGroups).sort((a, b) => a.localeCompare(b));
        const countryGroupNames = [];

        countries.forEach(country => {
            const { emoji, name, proxies: countryProxies } = countryGroups[country];
            if (!countryProxies || countryProxies.length === 0) {
                return;
            }
            const groupName = `${emoji} ${name}`;
            const norm = normalize(groupName);
            if (!existingTags.has(norm)) {
                this.config.outbounds.push({
                    tag: groupName,
                    type: 'urltest',
                    outbounds: countryProxies
                });
                existingTags.add(norm);
            }
            countryGroupNames.push(groupName);
        });

        const nodeSelectTag = t('outboundNames.Node Select');
        const nodeSelectGroup = this.config.outbounds.find(o => normalize(o?.tag) === normalize(nodeSelectTag));
        if (nodeSelectGroup && Array.isArray(nodeSelectGroup.outbounds)) {
            const seen = new Set();
            const rebuilt = [
                'DIRECT',
                'REJECT',
                t('outboundNames.Auto Select'),
                ...(manualGroupName ? [manualGroupName] : []),
                ...countryGroupNames
            ].filter(Boolean);
            nodeSelectGroup.outbounds = rebuilt.filter(name => {
                if (seen.has(name)) return false;
                seen.add(name);
                return true;
            });
        }

        this.countryGroupNames = countryGroupNames;
        this.manualGroupName = manualGroupName;
    }

    formatConfig() {
        const rules = generateRules(this.selectedRules, this.customRules);
        const { site_rule_sets, ip_rule_sets } = generateRuleSets(this.selectedRules, this.customRules);

        this.config.route.rule_set = [...site_rule_sets, ...ip_rule_sets];

        rules.filter(rule => !!rule.domain_suffix || !!rule.domain_keyword).map(rule => {
            this.config.route.rules.push({
                domain_suffix: rule.domain_suffix,
                domain_keyword: rule.domain_keyword,
                protocol: rule.protocol,
                outbound: t(`outboundNames.${rule.outbound}`)
            });
        });

        rules.filter(rule => !!rule.site_rules[0]).map(rule => {
            this.config.route.rules.push({
                rule_set: [
                    ...(rule.site_rules.length > 0 && rule.site_rules[0] !== '' ? rule.site_rules : []),
                ],
                protocol: rule.protocol,
                outbound: t(`outboundNames.${rule.outbound}`)
            });
        });

        rules.filter(rule => !!rule.ip_rules[0]).map(rule => {
            this.config.route.rules.push({
                rule_set: [
                    ...(rule.ip_rules.filter(ip => ip.trim() !== '').map(ip => `${ip}-ip`))
                ],
                protocol: rule.protocol,
                outbound: t(`outboundNames.${rule.outbound}`)
            });
        });

        rules.filter(rule => !!rule.ip_cidr).map(rule => {
            this.config.route.rules.push({
                ip_cidr: rule.ip_cidr,
                protocol: rule.protocol,
                outbound: t(`outboundNames.${rule.outbound}`)
            });
        });

        this.config.route.rules.unshift(
            { clash_mode: 'direct', outbound: 'DIRECT' },
            { clash_mode: 'global', outbound: t('outboundNames.Node Select') },
            { action: 'sniff' },
            { protocol: 'dns', action: 'hijack-dns' }
        );

        this.config.route.auto_detect_interface = true;
        this.config.route.final = t('outboundNames.Fall Back');

        return this.config;
    }
}
