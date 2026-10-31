import copy
from unittest import TestCase
from unittest.mock import patch
from export_data import build_dashboard_payload, ExportError, api_request, SITES_SERVICE_HOST

class ObservationExportTests(TestCase):
    def fixture(self):
        return {'source':'500彩票网＋澳客交叉观察','sourceKind':'THIRD_PARTY_JINGCAI_OBSERVATIONS','officialVerification':'NOT_VERIFIED','analysisStatus':'PRE_ANALYSIS','formalEligible':False,'snapshotHash':'a'*64,'persistence':{'status':'verified','snapshotHash':'a'*64},'sourceHealth':{'succeeded':2,'hasData':True,'officialVerified':False},'updatedAt':'2026-11-01T07:00:00Z','matches':[{'sourceEventId':'observed:2026-11-01:周日001','formalEligible':False,'league':'测试','home':'甲队','away':'乙队','odds':['2.1','3.2','3.1']}]}

    def test_opt_in_observation_preserves_preanalysis_and_provenance(self):
        with patch.dict('os.environ',{'JPI_ALLOW_THIRD_PARTY_OBSERVATIONS':'1'}):
            result=build_dashboard_payload(self.fixture())
        self.assertEqual(result['analysis_status'],'PRE_ANALYSIS')
        self.assertFalse(result['official_verified'])
        self.assertFalse(result['formal_eligible'])
        self.assertEqual(result['snapshot_hash'],'a'*64)
        self.assertIsNone(result['matches'][0]['ev_value'])
        self.assertAlmostEqual(sum(result['matches'][0][k] for k in ['prob_home','prob_draw','prob_away']),1,places=5)

    def test_default_official_only_contract_stays_strict(self):
        with patch.dict('os.environ',{},clear=True),self.assertRaises(ExportError):
            build_dashboard_payload(self.fixture())

    def test_no_formal_upgrade_missing_proof_or_official_identity_substitution(self):
        for change in [lambda p:p.update(formalEligible=True),lambda p:p.update(persistence={}),lambda p:p['matches'][0].update(sourceEventId='123'),lambda p:p['matches'][0].update(formalEligible=True),lambda p:p['sourceHealth'].update(succeeded=1)]:
            p=self.fixture();change(p)
            with patch.dict('os.environ',{'JPI_ALLOW_THIRD_PARTY_OBSERVATIONS':'1'}),self.assertRaises(ExportError):
                build_dashboard_payload(p)

    def test_upload_uses_exact_same_private_site_boundary(self):
        with patch.dict('os.environ',{'SITES_SERVICE_TOKEN':'synthetic'},clear=True):
            request,authenticated=api_request('https://'+SITES_SERVICE_HOST+'/api/football/observations')
            self.assertTrue(authenticated)
            self.assertEqual(request.get_header('Oai-sites-authorization'),'Bearer synthetic')
            with self.assertRaises(ExportError):
                api_request('https://other.example/api/football/observations')
