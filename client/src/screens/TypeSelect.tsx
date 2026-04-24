import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import styles from './TypeSelect.module.css';

export default function TypeSelect() {
  const navigate = useNavigate();
  const { setProjectType } = useAppStore();

  function choose(type: 'industrial' | 'residential') {
    setProjectType(type);
    navigate('/projects');
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.eyebrow}>Active Acquisitions</div>
        <h1 className={styles.heading}>Select Project Type</h1>
        <p className={styles.sub}>Choose the type of project you are working on to load the correct budget template and account codes.</p>

        <div className={styles.cards}>
          <button className={styles.card} onClick={() => choose('industrial')}>
            <div className={styles.cardIcon}>⬛</div>
            <div className={styles.cardLabel}>Industrial</div>
            <div className={styles.cardDesc}>
              Warehouse, flex, manufacturing, logistics, mixed-use commercial
            </div>
            <div className={styles.cardArrow}>→</div>
          </button>

          <button className={styles.card} onClick={() => choose('residential')}>
            <div className={styles.cardIcon}>⬜</div>
            <div className={styles.cardLabel}>Residential</div>
            <div className={styles.cardDesc}>
              Multifamily, townhome, single-family, mixed-use residential
            </div>
            <div className={styles.cardArrow}>→</div>
          </button>
        </div>
      </div>
    </div>
  );
}
