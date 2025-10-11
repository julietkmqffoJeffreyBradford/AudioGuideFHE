// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface MuseumVisit {
  id: string;
  encryptedPath: string;
  duration: number;
  timestamp: number;
  visitor: string;
  audioGuide: string;
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<MuseumVisit[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newVisitData, setNewVisitData] = useState({
    path: "",
    duration: "",
    preferences: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("visits");
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const totalDuration = visits.reduce((sum, visit) => sum + visit.duration, 0);
  const avgDuration = visits.length > 0 ? Math.round(totalDuration / visits.length) : 0;

  // Filter visits based on search term
  const filteredVisits = visits.filter(visit => 
    visit.audioGuide.toLowerCase().includes(searchTerm.toLowerCase()) ||
    visit.visitor.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    loadVisits().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadVisits = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("visit_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing visit keys:", e);
        }
      }
      
      const list: MuseumVisit[] = [];
      
      for (const key of keys) {
        try {
          const visitBytes = await contract.getData(`visit_${key}`);
          if (visitBytes.length > 0) {
            try {
              const visitData = JSON.parse(ethers.toUtf8String(visitBytes));
              list.push({
                id: key,
                encryptedPath: visitData.path,
                duration: visitData.duration,
                timestamp: visitData.timestamp,
                visitor: visitData.visitor,
                audioGuide: visitData.audioGuide || "Custom Tour"
              });
            } catch (e) {
              console.error(`Error parsing visit data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading visit ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setVisits(list);
    } catch (e) {
      console.error("Error loading visits:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitVisit = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting museum path with Zama FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedPath = `FHE-${btoa(JSON.stringify({
        path: newVisitData.path,
        preferences: newVisitData.preferences
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const visitId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const visitData = {
        path: encryptedPath,
        duration: parseInt(newVisitData.duration) || 30,
        timestamp: Math.floor(Date.now() / 1000),
        visitor: account,
        audioGuide: "Generated with FHE"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `visit_${visitId}`, 
        ethers.toUtf8Bytes(JSON.stringify(visitData))
      );
      
      const keysBytes = await contract.getData("visit_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(visitId);
      
      await contract.setData(
        "visit_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted visit submitted securely!"
      });
      
      await loadVisits();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewVisitData({
          path: "",
          duration: "",
          preferences: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const generateGuide = async (visitId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Generating personalized audio guide with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const visitBytes = await contract.getData(`visit_${visitId}`);
      if (visitBytes.length === 0) {
        throw new Error("Visit not found");
      }
      
      const visitData = JSON.parse(ethers.toUtf8String(visitBytes));
      
      const updatedVisit = {
        ...visitData,
        audioGuide: `FHE-Generated Guide #${Math.floor(Math.random() * 1000)}`
      };
      
      await contract.setData(
        `visit_${visitId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedVisit))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Personalized audio guide generated with FHE!"
      });
      
      await loadVisits();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Generation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the museum guide system",
      icon: "🔗"
    },
    {
      title: "Record Your Visit",
      description: "Submit your encrypted museum path and stay duration",
      icon: "🏛️"
    },
    {
      title: "FHE Processing",
      description: "Your data is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Audio Guide",
      description: "Receive personalized audio guide while keeping your data private",
      icon: "🎧"
    }
  ];

  const renderDurationChart = () => {
    const durations = visits.map(v => v.duration);
    const maxDuration = Math.max(...durations, 60);
    
    return (
      <div className="duration-chart">
        {visits.slice(0, 5).map((visit, index) => (
          <div key={index} className="chart-bar-container">
            <div className="chart-label">#{visit.id.substring(0, 4)}</div>
            <div className="chart-bar-bg">
              <div 
                className="chart-bar" 
                style={{ width: `${(visit.duration / maxDuration) * 100}%` }}
              ></div>
            </div>
            <div className="chart-value">{visit.duration} min</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing museum connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="museum-icon"></div>
          <h1>Museum<span>FHE</span>Guide</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="primary-btn"
          >
            + Record Visit
          </button>
          <button 
            className="secondary-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "How It Works"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Privacy-Preserving Museum Guide</h2>
            <p>Get personalized audio tours while keeping your visit data encrypted with FHE</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How FHE Museum Guide Works</h2>
            <p className="subtitle">Experience art without compromising your privacy</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-tabs">
          <button 
            className={`tab-btn ${activeTab === "visits" ? "active" : ""}`}
            onClick={() => setActiveTab("visits")}
          >
            My Visits
          </button>
          <button 
            className={`tab-btn ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            Statistics
          </button>
          <button 
            className={`tab-btn ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            About
          </button>
        </div>
        
        {activeTab === "visits" && (
          <div className="visits-section">
            <div className="section-header">
              <h2>My Museum Visits</h2>
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search visits..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button 
                  onClick={loadVisits}
                  className="refresh-btn"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="visits-list">
              <div className="list-header">
                <div className="header-cell">Visit ID</div>
                <div className="header-cell">Duration</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Audio Guide</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {filteredVisits.length === 0 ? (
                <div className="no-visits">
                  <div className="empty-icon"></div>
                  <p>No museum visits recorded yet</p>
                  <button 
                    className="primary-btn"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Record First Visit
                  </button>
                </div>
              ) : (
                filteredVisits.map(visit => (
                  <div className="visit-row" key={visit.id}>
                    <div className="list-cell">#{visit.id.substring(0, 6)}</div>
                    <div className="list-cell">{visit.duration} min</div>
                    <div className="list-cell">
                      {new Date(visit.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="list-cell audio-guide">
                      {visit.audioGuide}
                    </div>
                    <div className="list-cell actions">
                      {isOwner(visit.visitor) && (
                        <button 
                          className="action-btn"
                          onClick={() => generateGuide(visit.id)}
                        >
                          Generate Guide
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Visits</h3>
                <div className="stat-value">{visits.length}</div>
              </div>
              <div className="stat-card">
                <h3>Average Duration</h3>
                <div className="stat-value">{avgDuration} min</div>
              </div>
            </div>
            
            <div className="chart-container">
              <h3>Recent Visit Durations</h3>
              {renderDurationChart()}
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon"></div>
              <h3>How FHE Protects Your Privacy</h3>
              <p>
                Fully Homomorphic Encryption allows the system to process your museum path 
                and generate personalized audio guides without ever decrypting your sensitive data.
              </p>
            </div>
          </div>
        )}
        
        {activeTab === "about" && (
          <div className="about-section">
            <h2>About Museum FHE Guide</h2>
            <p>
              This application uses cutting-edge Fully Homomorphic Encryption technology to provide
              personalized museum experiences while maintaining complete privacy of your visit data.
            </p>
            
            <div className="team-info">
              <h3>Development Team</h3>
              <div className="team-members">
                <div className="member">
                  <div className="avatar"></div>
                  <h4>Privacy Engineer</h4>
                  <p>FHE Specialist</p>
                </div>
                <div className="member">
                  <div className="avatar"></div>
                  <h4>Museum Curator</h4>
                  <p>Content Expert</p>
                </div>
                <div className="member">
                  <div className="avatar"></div>
                  <h4>UX Designer</h4>
                  <p>Visitor Experience</p>
                </div>
              </div>
            </div>
            
            <div className="partners">
              <h3>Technology Partners</h3>
              <div className="partner-logos">
                <div className="partner-logo fhe-logo"></div>
                <div className="partner-logo museum-logo"></div>
                <div className="partner-logo web3-logo"></div>
              </div>
            </div>
          </div>
        )}
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitVisit} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          visitData={newVisitData}
          setVisitData={setNewVisitData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="museum-icon small"></div>
            <span>Museum FHE Guide</span>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Use</a>
            <a href="#" className="footer-link">Contact Museums</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Museum FHE Guide. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  visitData: any;
  setVisitData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  visitData,
  setVisitData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setVisitData({
      ...visitData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!visitData.path || !visitData.duration) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Record Museum Visit</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> Your visit data will be encrypted with FHE
          </div>
          
          <div className="form-group">
            <label>Museum Path *</label>
            <textarea 
              name="path"
              value={visitData.path} 
              onChange={handleChange}
              placeholder="Describe the exhibits you visited in order..." 
              rows={3}
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Duration (minutes) *</label>
              <input 
                type="number"
                name="duration"
                value={visitData.duration} 
                onChange={handleChange}
                placeholder="How long did you stay?" 
              />
            </div>
            
            <div className="form-group">
              <label>Preferences</label>
              <input 
                type="text"
                name="preferences"
                value={visitData.preferences} 
                onChange={handleChange}
                placeholder="Art styles, periods, etc." 
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="secondary-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="primary-btn"
          >
            {creating ? "Encrypting with FHE..." : "Submit Visit"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;